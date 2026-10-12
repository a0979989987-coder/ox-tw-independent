import { selectSectors } from './research-data.js?v=20261001-twhome1';

// Historical aggregates do not contain per-stock quotes. Keep their date and
// amounts, and explicitly date the constituent snapshot instead of relabelling it.
export function sectorDetailSnapshot(data, sector, { classification = 'theme', market = 'ALL' } = {}) {
  if (!sector) return null;
  const dated = sector.date && data?.history?.find(day => day.date === sector.date && day.stocks?.length);
  const snapshot = dated || data;
  const members = selectSectors(snapshot, { classification, market }).find(s => s.name === sector.name);
  return { ...sector, date: sector.date || data?.date || null,
    memberDate: snapshot?.date || null, rows: members?.rows || sector.rows || [] };
}
