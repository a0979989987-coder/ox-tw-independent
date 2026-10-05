export const MARKET_NAMES = { tw: '台股', all: '台股新聞' };
export const CATEGORY_NAMES = {
  dividend: '除權息', macro: '國際財經數據', earnings: '法說會', holiday: '休市／交易日',
  'dividend-preview': '除權息預告', payment: '現金發放日', exchange: '交易所事件'
};
export const MARKET_CATEGORIES = {
  tw: ['dividend', 'macro', 'earnings', 'holiday', 'dividend-preview', 'payment', 'exchange'],
  all: Object.keys(CATEGORY_NAMES)
};
const source = (id, name, markets, extra = {}) => ({ id, name, markets, status: 'not-connected', ...extra });
export const SOURCE_CATALOG = [
  source('twse', '臺灣證券交易所', ['tw']), source('tpex', '證券櫃檯買賣中心', ['tw']),
  source('technews', '科技新報', ['tw']), source('digitimes', 'DIGITIMES／電子時報', ['tw']),
  source('yahoo', 'Yahoo', ['tw'], { aggregator: true }), source('cnyes', '鉅亨網', ['tw']),
  source('wantgoo', '玩股網', ['tw']), source('google-news', 'Google 新聞', ['tw'], { aggregator: true }),
  source('ltn', '自由時報', ['tw']), source('cna', '中央通訊社', ['tw']), source('udn', '經濟日報', ['tw']),
  source('ctee', '工商時報', ['tw']), source('cmoney', 'CMoney 投資網誌', ['tw']), source('chinatimes', '中時新聞網', ['tw']),
  source('168', '168 財經', ['tw']), source('investing', 'Investing', ['tw']),
  source('forexfactory', 'Forex Factory', ['tw']), source('moneydj', 'MoneyDJ 理財網', ['tw']),
  source('pchome', 'PChome 股市', ['tw']), source('ebc', '東森財經新聞網', ['tw']), source('msn', 'MSN 財經', ['tw'], { aggregator: true }),
  source('fed', '美國聯準會', ['tw']), source('bls-cpi', '美國勞工統計局・物價', ['tw']), source('bls-jobs', '美國勞工統計局・就業', ['tw']),
  source('nyse-calendar', 'NYSE・美股休市／提早收盤', ['tw']),
  source('bls-calendar', '美國勞工統計局・行事曆', ['tw']), source('ecb', '歐洲央行', ['tw']),
  source('twse-dividends', '證交所・除權息預告', ['tw']), source('twse-holidays', '證交所・交易日曆', ['tw']),
  source('tpex-dividends', '櫃買中心・除權息預告', ['tw']), source('tpex-dividends-daily', '櫃買中心・除權息結果', ['tw']),
  source('twse-conferences', '證交所・法說會月表', ['tw']),
  source('mops-conferences', '公開資訊觀測站・法說會', ['tw']), source('mops-payments', '公開資訊觀測站・配息', ['tw'])
];
export const TIME_CHOICES = [['3', '3 小時'], ['24', '24 小時'], ['168', '1 週'], ['720', '30 日']];
export const EVENT_PROVIDERS = { macro: ['bls-calendar'], 'dividend-preview': ['twse-dividends','tpex-dividends'], dividend: ['tpex-dividends-daily'], earnings: ['twse-conferences','mops-conferences'], holiday: ['twse-holidays','nyse-calendar'], exchange:['nyse-calendar'], payment: ['mops-payments'] };
export function sourceName(item) { return SOURCE_CATALOG.find(s => s.id === (item.sourceId || item.id))?.name || item.source || item.name || item.sourceId || '來源待確認'; }
