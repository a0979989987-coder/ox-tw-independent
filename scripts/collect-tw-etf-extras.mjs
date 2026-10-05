import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { getHoldings, getHotStocks } from '../server/markets/tw/etf.js';

const folder = new URL('../data/tw-etf/', import.meta.url);
await mkdir(folder, { recursive: true });
const catalog = JSON.parse(await readFile(new URL('catalog.json', folder), 'utf8'));
let previous = { rows: {} };
try { previous = JSON.parse(await readFile(new URL('holdings.json', folder), 'utf8')); } catch {}
const rows = { ...previous.rows };
const eligible = catalog.rows.filter(row => /元大|富邦|國泰|永豐/.test(row.issuer) && !row.leveraged);
const priority = ['0050', '006208', '0056', '00878', '00919', '00713', '00679B'];
const choices = [...new Map([...priority.map(symbol => eligible.find(row => row.symbol === symbol)).filter(Boolean),
  ...eligible.sort((a, b) => (b.aum || 0) - (a.aum || 0)).slice(0, 40)].map(row => [row.symbol, row])).values()];
for (let i = 0; i < choices.length; i += 4) {
  await Promise.all(choices.slice(i, i + 4).map(async row => {
    try {
      const result = await getHoldings(row.symbol, { refresh: true });
      if (result.holdings?.length) rows[row.symbol] = result;
    } catch (error) { console.warn(`ETF holdings ${row.symbol}: retaining last valid snapshot: ${error.message}`); }
  }));
}
await writeFile(new URL('holdings.json', folder), JSON.stringify({ rows, acquiredAt: new Date().toISOString() }));
try {
  const hot = await getHotStocks({ refresh: true });
  if (hot.rows?.length) await writeFile(new URL('hot-stocks.json', folder), JSON.stringify(hot));
} catch (error) { console.warn('ETF hot stocks: retaining last valid snapshot:', error.message); }
console.log(`ETF holdings snapshots: ${Object.keys(rows).length}`);
