/** Official daily institutional research. Amounts are estimates, never turnover-as-flow. */
export const numeric = value => value == null || String(value).trim() === '' || !Number.isFinite(Number(String(value).replace(/,/g, ''))) ? null : Number(String(value).replace(/,/g, ''));
const clean = value => String(value ?? '').replace(/<[^>]*>/g, '').replace(/[\s（）()]/g, '');
export function reportTables(payload) {
  const tables = [...(payload?.tables || []), payload];
  return tables.filter(t => Array.isArray(t?.fields) && Array.isArray(t?.data)).map(t => ({
    fields: t.fields.map(f => clean(typeof f === 'object' ? f.name || f.title : f)), data: t.data
  }));
}
export function normalizeInstitutional(payload, market, date) {
  const table = reportTables(payload).find(t => t.fields.some(f => /三大法人買賣超/.test(f)));
  if (!table) throw new Error(`${market}: no institutional field definitions`);
  const index = names => table.fields.findIndex(f => names.includes(f));
  const symbol = index(['證券代號', '代號']);
  const total = table.fields.findIndex(f => /三大法人買賣超/.test(f));
  const foreign = index(['外陸資買賣超股數不含外資自營商', '外資及陸資不含外資自營商買賣超股數', '外資及陸資買賣超股數']);
  const trust = index(['投信買賣超股數']);
  const dealer = index(['自營商買賣超股數']);
  if (symbol < 0 || total < 0) throw new Error(`${market}: unsupported institutional schema`);
  return table.data.map(row => ({ symbol: String(row[symbol]).trim(), market, date,
    netShares: numeric(row[total]), foreignShares: numeric(row[foreign]), trustShares: numeric(row[trust]), dealerShares: numeric(row[dealer])
  })).filter(row => /^\d{4,6}$/.test(row.symbol) && row.netShares !== null);
}
export async function officialJSON(url, fetcher = fetch) {
  const response = await fetcher(url, { headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 OX TW Research' }, signal: AbortSignal.timeout(14000) });
  if (!response.ok) throw new Error(`Official source HTTP ${response.status}`);
  return response.json();
}
export async function loadInstitutional(date, market, fetcher = fetch) {
  const compact = date.replaceAll('-', '');
  const roc = `${Number(date.slice(0, 4)) - 1911}/${date.slice(5, 7)}/${date.slice(8)}`;
  const url = market === 'TWSE'
    ? `https://www.twse.com.tw/rwd/zh/fund/T86?response=json&date=${compact}&selectType=ALL`
    : `https://www.tpex.org.tw/web/stock/3insti/DAILY_TradE/3itrade_hedge_result.php?l=zh-tw&o=json&se=EW&t=D&d=${encodeURIComponent(roc)}`;
  const payload = await officialJSON(url, fetcher);
  const returnedDate = String(payload.date || payload.reportDate || '').replace(/[^0-9]/g, '');
  const normalizedDate = returnedDate.length === 7 ? String(Number(returnedDate.slice(0, 3)) + 1911) + returnedDate.slice(3) : returnedDate;
  if (normalizedDate.length === 8 && normalizedDate !== compact) throw new Error('Institutional date mismatch');
  // TWSE returns the requested trading date. Reject silently substituted dates.
  if (market === 'TWSE' && payload.date && payload.date !== compact) throw new Error('Institutional date mismatch');
  return normalizeInstitutional(payload, market, date);
}
export function joinResearchStocks(quotes, feeds, date) {
  const map = new Map(feeds.flat().filter(row => row.date === date).map(row => [`${row.market}:${row.symbol}`, row]));
  return quotes.filter(q => q.dataDate === date).map(q => {
    const flow = map.get(`${q.market}:${q.symbol}`);
    const estimated = shares => numeric(shares) === null || !(q.price > 0) ? null : shares * q.price;
    return { symbol: q.symbol, name: q.name, market: q.market, industry: q.industry || '未分類', price: q.price,
      changePct: q.changePct, turnoverTwd: q.turnoverTwd,
      netTwd: estimated(flow?.netShares), foreignTwd: estimated(flow?.foreignShares), trustTwd: estimated(flow?.trustShares), dealerTwd: estimated(flow?.dealerShares) };
  });
}
export function aggregateSectors(stocks) {
  const groups = new Map();
  for (const stock of stocks) {
    const key = stock.industry;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(stock);
  }
  return [...groups].map(([name, rows]) => {
    const flows = rows.filter(r => Number.isFinite(r.netTwd));
    const changes = rows.filter(r => Number.isFinite(r.changePct));
    return { name, count: rows.length, covered: flows.length, buyCount: flows.filter(r => r.netTwd > 0).length,
      flow: flows.length ? flows.reduce((n, r) => n + r.netTwd, 0) : null,
      changePct: changes.length ? changes.reduce((n, r) => n + r.changePct, 0) / changes.length : null,
      turnoverTwd: rows.reduce((n, r) => n + (r.turnoverTwd || 0), 0),
      leader: [...flows].sort((a, b) => b.netTwd - a.netTwd)[0]?.symbol || null };
  });
}
// A temporary outage may retain verified flows only for the same trading date.
// Newly completed price bars do not have to wait for institutional publication.
export function retainResearchFlows(snapshot, previous) {
  if(previous?.date!==snapshot.date)return snapshot;
  const rows=new Map((previous.stocks||[]).map(s=>[s.market+':'+s.symbol,s]));
  const fields=['netTwd','foreignTwd','trustTwd','dealerTwd'];
  snapshot.stocks=snapshot.stocks.map(stock=>{
    const old=rows.get(stock.market+':'+stock.symbol);
    if(snapshot.sourceHealth?.[stock.market]?.ok || !old)return stock;
    const retained={...stock};let preserved=false;
    for(const field of fields)if(!Number.isFinite(stock[field])&&Number.isFinite(old[field])){retained[field]=old[field];preserved=true;}
    if(preserved)snapshot.sourceHealth[stock.market]={...snapshot.sourceHealth[stock.market],stale:true};
    return retained;
  });
  return snapshot;
}
export function enrichResearch(snapshot, history = []) {
  const dates = [...new Map([...history.filter(h => h.date <= snapshot.date), snapshot].map(h => [h.date, h])).values()].sort((a, b) => a.date.localeCompare(b.date));
  const sectors = aggregateSectors(snapshot.stocks);
  for (const sector of sectors) {
    const window = dates.slice(-20).map(d => (d.sectors || aggregateSectors(d.stocks || [])).find(s => s.name === sector.name));
    const complete = n => window.length >= n && window.slice(-n).every(s => s && s.covered === s.count && Number.isFinite(s.flow));
    sector.flow5 = complete(5) ? window.slice(-5).reduce((n, s) => n + s.flow, 0) : null;
    sector.flow20 = complete(20) ? window.reduce((n, s) => n + s.flow, 0) : null;
    sector.momentum = sector.flow5 !== null && sector.flow20 !== null ? sector.flow5 / 5 - sector.flow20 / 20 : null;
  }
  return { ...snapshot, sectors, history: dates.slice(-40).map(d => ({ date: d.date, sectors: d.sectors || aggregateSectors(d.stocks || []) })),
    methodology: 'net-shares-times-daily-close-v1', realtime: false };
}
