import { escape } from './research-ui.js';

export const REPLAY_PERIODS = Object.freeze([
  { id: '1w', label: '1 週', days: 7 },
  { id: '2w', label: '2 週', days: 14 },
  { id: '1m', label: '1 個月', months: 1 },
  { id: '2m', label: '2 個月', months: 2 },
  { id: '1q', label: '1 季', months: 3 },
  { id: '2q', label: '2 季', months: 6 },
  { id: '3q', label: '3 季', months: 9 },
  { id: '1y', label: '1 年', months: 12 },
  { id: 'all', label: '全部歷史' }
]);
export const REPLAY_SPEEDS = Object.freeze([0.1, 0.2, 0.3, 0.5, 0.75, 1, 1.5, 2, 3, 4]);
// A full year plus the preceding 20-session momentum window. The larger
// archive is fetched on demand; the first market load stays compact.
export const REPLAY_HISTORY_LIMIT = 320;

export function selectReplayWindow(days, period = '1m') {
  const option = REPLAY_PERIODS.find(item => item.id === period) || REPLAY_PERIODS[2];
  const end = days.at(-1)?.date;
  if (!end) return { days: [], start: null, end: null, limited: false };
  if (option.id === 'all') return { days, start: days[0].date, end, limited: false };
  const boundary = new Date(`${end}T00:00:00Z`);
  if (option.days) boundary.setUTCDate(boundary.getUTCDate() - option.days);
  else {
    const date = boundary.getUTCDate();
    boundary.setUTCDate(1);
    boundary.setUTCMonth(boundary.getUTCMonth() - option.months);
    const last = new Date(Date.UTC(boundary.getUTCFullYear(), boundary.getUTCMonth() + 1, 0)).getUTCDate();
    boundary.setUTCDate(Math.min(date, last));
  }
  // Trailing calendar period (boundary, latest observation], not a fixed
  // number of sessions. Holidays never get fabricated observations.
  boundary.setUTCDate(boundary.getUTCDate() + 1);
  const start = boundary.toISOString().slice(0, 10);
  return { days: days.filter(day => day.date >= start), start, end, limited: days[0].date > start };
}

export function replayPositionForDate(previousDays, position, nextDays) {
  const date = previousDays[Math.floor(position)]?.date;
  const index = nextDays.findIndex(day => day.date === date);
  return index < 0 ? 0 : Math.min(index + position % 1, Math.max(0, nextDays.length - 1));
}

export function replayOptionControls(period, speed) {
  return `<div class="twx-replay-options"><label><span>期間</span><select data-replay-period aria-label="回放期間">${REPLAY_PERIODS.map(item => `<option value="${item.id}" ${period === item.id ? 'selected' : ''}>${escape(item.label)}</option>`).join('')}</select></label><label><span>速度</span><select data-replay-speed aria-label="回放速度">${REPLAY_SPEEDS.map(value => `<option value="${value}" ${speed === value ? 'selected' : ''}>${value}x</option>`).join('')}</select></label></div>`;
}
