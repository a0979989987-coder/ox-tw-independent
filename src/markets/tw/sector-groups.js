import { SECTOR_DEFINITIONS, SECTOR_TAXONOMY_VERSION } from './sector-taxonomy.js';

const memberships = new Map();
for (const definition of SECTOR_DEFINITIONS) for (const symbol of definition.symbols) {
  if (!memberships.has(symbol)) memberships.set(symbol, []);
  memberships.get(symbol).push(definition.name);
}
// New official listings must remain visible even before the thematic list is
// revised. Add them only to the matching broad/residual industry, not to an
// inferred technology topic such as HBM or liquid cooling.
const residual = new Map(Object.entries({
  半導體業: '半導體・其他', 電子零組件業: '電子零組件・其他', 通信網路業: '通信網路・其他',
  電子通路業: '電子通路・其他', 光電業: '光電・其他', 其他電子業: '其他電子・其他',
  電腦及週邊設備業: '電腦週邊・其他', 數位雲端: '數位雲端・其他', 資訊服務業: '資訊服務・其他',
  電器電纜: '電器電纜・其他', 綠能環保: '綠能環保・其他', 油電燃氣業: '油電燃氣',
  金融保險業: '金融保險・其他', 金融業: '金融保險・其他', 電機機械: '電機機械・其他',
  汽車工業: '汽車工業・其他', 塑膠工業: '塑膠・其他', 化學工業: '化學工業・其他',
  鋼鐵工業: '鋼鐵金屬', 紡織纖維: '紡織成衣', 水泥工業: '水泥', 橡膠工業: '橡膠',
  玻璃陶瓷: '玻璃陶瓷', 造紙工業: '造紙', 文化創意業: '文化創意', 觀光餐旅: '觀光餐旅',
  農業科技: '農業科技', 居家生活: '居家生活', 貿易百貨: '貿易百貨',
  運動休閒: '運動休閒', 食品工業: '食品飲料', 建材營造: '營建地產', 生技醫療業: '生技醫療'
}));

export function themeGroups(stocks = []) {
  const groups = new Map(SECTOR_DEFINITIONS.map(definition => [definition.name, { ...definition, rows: [] }]));
  const unique = new Map(stocks.map(stock => [stock.market + ':' + stock.symbol, stock]));
  for (const stock of unique.values()) {
    const names = memberships.get(stock.symbol) || [residual.get(stock.industry) || '其他產業'];
    for (const name of names) groups.get(name)?.rows.push(stock);
  }
  return [...groups.values()];
}

export function aggregateThemes(stocks) {
  return themeGroups(stocks).map(({ name, group, rows }) => {
    const flows = rows.filter(row => Number.isFinite(row.netTwd));
    const prices = rows.filter(row => Number.isFinite(row.changePct));
    const amounts = rows.filter(row => Number.isFinite(row.turnoverTwd));
    return { name, group, count: rows.length, covered: flows.length, buyCount: flows.filter(row => row.netTwd > 0).length,
      flow: flows.length ? flows.reduce((n, row) => n + row.netTwd, 0) : null,
      changePct: prices.length ? prices.reduce((n, row) => n + row.changePct, 0) / prices.length : null,
      turnoverTwd: amounts.length ? amounts.reduce((n, row) => n + row.turnoverTwd, 0) : null,
      leader: [...flows].sort((a, b) => b.netTwd - a.netTwd)[0]?.symbol || null };
  });
}

export function enrichThemeSnapshot(snapshot, history = []) {
  const current = { date: snapshot.date, themeVersion: SECTOR_TAXONOMY_VERSION, themes: aggregateThemes(snapshot.stocks || []) };
  const days = [...new Map([...history.filter(day => day.date <= snapshot.date), current].map(day => [day.date, day])).values()]
    .sort((a, b) => a.date.localeCompare(b.date));
  const themes = current.themes.map(theme => {
    const window = days.slice(-20).map(day => day.themeVersion === SECTOR_TAXONOMY_VERSION ? day.themes?.find(row => row.name === theme.name) : null);
    const complete = n => window.length >= n && window.slice(-n).every(row => row && row.count > 0 && row.covered === row.count && Number.isFinite(row.flow));
    const flow5 = complete(5) ? window.slice(-5).reduce((n, row) => n + row.flow, 0) : null;
    const flow20 = complete(20) ? window.reduce((n, row) => n + row.flow, 0) : null;
    return { ...theme, flow5, flow20, momentum: flow5 !== null && flow20 !== null ? flow5 / 5 - flow20 / 20 : null };
  });
  return { themes, themeVersion: SECTOR_TAXONOMY_VERSION };
}
