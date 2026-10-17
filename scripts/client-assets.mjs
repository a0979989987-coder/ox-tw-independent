import { createHash } from 'node:crypto';
// Keep complete official records; only split when each screen needs them.
export const TOOL_STYLES = [
  'src/markets/tw/radar-ui.css', 'src/markets/tw/radar-ui-light.css',
  'src/components/patterns/patterns.css', 'src/components/patterns/patterns-light.css',
  'src/components/bubbles/bubbles.css', 'src/components/bubbles/bubbles-light.css',
  'src/markets/tw/etf/style.css', 'src/markets/tw/etf/style-light.css',
  'src/styles/themes/light-tool-roles.css'
];
export const NEWS_PAGE_SIZE = 200;
// The key-news feed is published as a small index plus pages of 200 articles,
// newest first, so the client loads only the pages its date range needs.
// news-feed.json stays published for clients still running the previous build.
export function newsFeedPages(snapshot, pageSize = NEWS_PAGE_SIZE) {
  const news = [...snapshot.news];
  for (let i = 1; i < news.length; i++) if ((news[i].publishedAt || '') > (news[i - 1].publishedAt || '')) {
    news.sort((a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || '')); break;
  }
  const pages = [];
  for (let start = 0; start < news.length || start === 0; start += pageSize) {
    pages.push({ schemaVersion: 1, generatedAt: snapshot.generatedAt, page: pages.length, news: news.slice(start, start + pageSize) });
    if (!news.length) break;
  }
  const index = { schemaVersion: 1, generatedAt: snapshot.generatedAt, pageSize, total: news.length,
    newest: news[0]?.publishedAt || null, oldest: news.at(-1)?.publishedAt || null, pendingNews: snapshot.pendingNews || [],
    pages: pages.map(page => ({ file: `news-feed-p${page.page}.json`, count: page.news.length, newest: page.news[0]?.publishedAt || null, oldest: page.news.at(-1)?.publishedAt || null })) };
  return { index, pages };
}
export function newsAssets(snapshot) {
  if (snapshot.schemaVersion !== 1 || !Array.isArray(snapshot.news) || !Array.isArray(snapshot.events)) throw Error('Invalid news snapshot');
  const { news, pendingNews = [], assetCatalog, ...calendar } = snapshot;
  const paged = newsFeedPages(snapshot);
  return {
    calendar: { ...calendar, news: [], pendingNews: [], feedComplete: false },
    feed: { ...calendar, news, pendingNews, feedComplete: true },
    'feed-index': paged.index,
    ...Object.fromEntries(paged.pages.map(page => [`feed-p${page.page}`, page])),
    headline: { generatedAt: snapshot.generatedAt, title: news.find(item => item.markets?.includes('tw'))?.titleZh || news.find(item => item.markets?.includes('tw'))?.title || '台灣市場 · 官方日行情' }
  };
}
// The build version names the program: the HTML shell, without the content
// versions of the data files it preloads, and every generated JS/CSS asset
// with its content. Data snapshots are deployed several times a day; they
// must not count as a new build, which would retire the assets of pages that
// are still open (and offer every visitor a refresh).
export function programVersion(html, assets) {
  const hash = createHash('sha256').update(html.replace(/(data\/[\w.-]+\.json)\?v=[\w-]+/g, '$1'));
  for (const path of Object.keys(assets).sort()) hash.update(`\n${path}:${assets[path]}`);
  return hash.digest('hex').slice(0, 12);
}
