export function releaseRangeRows(disposals, range = '3') {
  const limit = range === 'all' ? Infinity : range === '5' ? 5 : 3;
  return (disposals || []).filter(row => {
    const days = row.disposition?.releaseDays;
    return Number.isInteger(days) && days >= 0 && days <= limit && !row.disposition?.scheduled;
  }).map(row => ({...row, disposition:{...row.disposition, status:'release'}}))
    .sort((a,b) => a.disposition.endDate.localeCompare(b.disposition.endDate) || a.symbol.localeCompare(b.symbol));
}
