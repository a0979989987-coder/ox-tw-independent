const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const taipeiTradingDate = (now = new Date()) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit'
}).format(now);

// Recalculate a published period against its official exchange calendar. A
// cached countdown is not valid across weekends, holidays or a midnight change.
export function currentTWDisposition(row, calendar, today = taipeiTradingDate()) {
  const d = row?.disposition;
  if (!d || !DATE.test(d.startDate || '') || !DATE.test(d.endDate || '')) return row;
  const scheduled = d.startDate > today;
  const ended = d.endDate < today;
  let releaseDays = d.releaseDays ?? null;
  const checked = d.checkedAt ? new Date(d.checkedAt) : null;
  if (!checked || !Number.isFinite(checked.getTime()) || taipeiTradingDate(checked) !== today) releaseDays = null;
  if (calendar?.years?.includes(today.slice(0, 4)) && calendar.years.includes(d.endDate.slice(0, 4))) {
    const closed = new Set(calendar.closed || []), open = new Set(calendar.open || []);
    releaseDays = 0;
    let date = new Date(today + 'T00:00:00Z');
    for (let guard = 0; guard < 370; guard++) {
      date.setUTCDate(date.getUTCDate() + 1);
      const iso = date.toISOString().slice(0, 10);
      if (iso > d.endDate) break;
      if (open.has(iso) || (date.getUTCDay() !== 0 && date.getUTCDay() !== 6 && !closed.has(iso))) releaseDays++;
    }
  }
  return { ...row, disposition: { ...d, scheduled, ended, releaseDays,
    status: scheduled ? 'risk' : ended ? 'ended' : d.status === 'release' ? 'release' : 'active' } };
}
