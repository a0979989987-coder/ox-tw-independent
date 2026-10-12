// Keep complete official records; only split when each screen needs them.
export const TOOL_STYLES = [
  'src/markets/tw/radar-ui.css', 'src/markets/tw/radar-ui-light.css',
  'src/components/patterns/patterns.css', 'src/components/patterns/patterns-light.css',
  'src/components/bubbles/bubbles.css', 'src/components/bubbles/bubbles-light.css',
  'src/markets/tw/etf/style.css', 'src/markets/tw/etf/style-light.css',
  'src/styles/themes/light-tool-roles.css'
];
export function newsAssets(snapshot) {
  if (snapshot.schemaVersion !== 1 || !Array.isArray(snapshot.news) || !Array.isArray(snapshot.events)) throw Error('Invalid news snapshot');
  const { news, pendingNews = [], assetCatalog, ...calendar } = snapshot;
  return {
    calendar: { ...calendar, news: [], pendingNews: [], feedComplete: false },
    feed: { ...calendar, news, pendingNews, feedComplete: true },
    headline: { generatedAt: snapshot.generatedAt, title: news.find(item => item.markets?.includes('tw'))?.titleZh || news.find(item => item.markets?.includes('tw'))?.title || '台灣市場 · 官方日行情' }
  };
}
