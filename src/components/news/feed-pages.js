// Append the next page of the paged key-news feed, returning a new snapshot
// (the workspace re-renders when the snapshot object changes).
export function mergeFeedPage(snapshot, news) {
  const paging = snapshot.feedPaging, loaded = paging.loaded + 1;
  const page = paging.index.pages[loaded - 1];
  return { ...snapshot, news: [...snapshot.news, ...news],
    feedPaging: { ...paging, loaded, oldestLoaded: page?.oldest || paging.oldestLoaded || null,
      loadedCount: (paging.loadedCount || 0) + news.length, complete: loaded >= paging.index.pages.length } };
}
// Whether pages older than the loaded ones are still needed for `from`.
export function feedNeedsMore(paging, from) {
  if (!paging || paging.complete || !(from < Infinity)) return false;
  return !(Date.parse(paging.oldestLoaded) <= from);
}
