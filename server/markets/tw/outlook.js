import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { loadTWTradingCalendar } from './surveillance.js';

const COOKIE = 'ox_tw_vote';
const VOTE_SCRIPT = `local prior = redis.call('HGET', KEYS[1], ARGV[1])
if prior ~= ARGV[2] then
  if prior then redis.call('HINCRBY', KEYS[2], prior, -1) end
  redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
  redis.call('HINCRBY', KEYS[2], ARGV[2], 1)
end
redis.call('EXPIRE', KEYS[1], 7776000)
redis.call('EXPIRE', KEYS[2], 7776000)
return {redis.call('HGET', KEYS[2], 'up') or '0', redis.call('HGET', KEYS[2], 'down') or '0'}`;

export function nextTWTradingDay(now, calendar) {
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  let date = today;
  for (let i = 0; i < 14; i++) {
    date = new Date(Date.parse(`${date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
    const open = calendar?.isOpen(date);
    if (open === null || open === undefined) return null;
    if (open) return date;
  }
  return null;
}

function signedId(value, secret) {
  return createHmac('sha256', secret).update(value).digest('hex');
}

function visitor(req, res, secret) {
  const raw = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1) || '';
  const [id, signature] = raw.split('.');
  if (/^[0-9a-f-]{36}$/.test(id || '') && /^[0-9a-f]{64}$/.test(signature || '')) {
    const expected = signedId(id, secret);
    if (timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'))) return id;
  }
  const fresh = randomUUID();
  res.setHeader('Set-Cookie', `${COOKIE}=${fresh}.${signedId(fresh, secret)}; Path=/api/v1/tw/outlook; Max-Age=15552000; HttpOnly; Secure; SameSite=Lax`);
  return fresh;
}

async function redis(command, fetcher = fetch) {
  const response = await fetcher(process.env.UPSTASH_REDIS_REST_URL, {
    method: 'POST', headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command), signal: AbortSignal.timeout(6000)
  });
  if (!response.ok) throw new Error('Vote store unavailable');
  const body = await response.json();
  if (body.error) throw new Error('Vote store error');
  return body.result;
}

function respond(res, status, value) { res.status(status).json(value); }

export async function handleTWOutlook(req, res, { calendarLoader = loadTWTradingCalendar, fetcher = fetch, now = new Date() } = {}) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (!['GET', 'POST'].includes(req.method)) return respond(res, 405, { error: 'METHOD_NOT_ALLOWED' });
  if (req.method === 'POST') {
    const origin = req.headers.origin;
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    let sameOrigin = false;
    try { sameOrigin = !!origin && !!host && new URL(origin).host === host; } catch {}
    if (!sameOrigin) return respond(res, 403, { error: 'ORIGIN_MISMATCH' });
    if (!['up', 'down'].includes(req.body?.side)) return respond(res, 400, { error: 'INVALID_SIDE' });
  }
  const secret = process.env.OX_POLL_SECRET;
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN || !secret || secret.length < 32) {
    return respond(res, 503, { error: 'POLL_NOT_CONFIGURED' });
  }
  try {
    const day = nextTWTradingDay(now, await calendarLoader());
    if (!day) return respond(res, 503, { error: 'TRADING_CALENDAR_UNAVAILABLE' });
    const id = signedId(visitor(req, res, secret), secret);
    const votes = `ox:tw:outlook:${day}:visitors`, counts = `ox:tw:outlook:${day}:counts`;
    let up, down, mine;
    if (req.method === 'POST') {
      if (req.body.day !== day) return respond(res, 409, { error: 'TRADING_DAY_CHANGED', day });
      [up, down] = await redis(['EVAL', VOTE_SCRIPT, '2', votes, counts, id, req.body.side], fetcher);
      mine = req.body.side;
    } else {
      [up, down] = await redis(['HMGET', counts, 'up', 'down'], fetcher) || [];
      mine = await redis(['HGET', votes, id], fetcher);
    }
    return respond(res, 200, { day, up: Math.max(0, Number(up) || 0), down: Math.max(0, Number(down) || 0), mine: ['up', 'down'].includes(mine) ? mine : null });
  } catch {
    return respond(res, 503, { error: 'POLL_UNAVAILABLE' });
  }
}
