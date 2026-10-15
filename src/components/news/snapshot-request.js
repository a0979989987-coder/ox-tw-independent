import {withDeadline} from '../resource-deadline.js';
import {fetchWithProgress} from '../progress-fetch.js';
const validSnapshot=data=>data.schemaVersion===1&&Array.isArray(data.news)&&Array.isArray(data.events);
export function createNewsLoader(fetcher = fetch, timeoutMs = 10000, valid = validSnapshot) {
  return async function loadNews(url, {force = false} = {}) {
    let error;
    for(let attempt=0;attempt<2;attempt++) {
      try {
        return await withDeadline(async signal=>{
          const response=await fetcher(url,{signal,cache:force||attempt?'reload':'default'});
          if(!response.ok)throw Object.assign(Error(`HTTP ${response.status}`),{status:response.status});
          const data=await response.json();
          if(!valid(data))throw Error('新聞資料格式不正確');
          return data;
        },timeoutMs,'新聞連線逾時');
      } catch(cause) {
        error=cause;
        if(cause.status===403||cause.status===401||cause.status===404)break;
      }
    }
    throw error;
  };
}
export const loadNewsSnapshot=createNewsLoader();
// Paged key-news feed: a small index and 200-article pages.
export const loadNewsFeedIndex=createNewsLoader(fetch,10000,data=>data.schemaVersion===1&&Array.isArray(data.pages)&&Number.isFinite(data.total)&&Array.isArray(data.pendingNews));
export const loadNewsFeedPage=createNewsLoader(fetch,10000,data=>data.schemaVersion===1&&Array.isArray(data.news));
// Complete feed (only when the paged index is unavailable): a large file, so
// abort only when the download stops advancing, not after a fixed 10 seconds.
export async function loadFullNewsFeed(url,{force=false,fetcher=fetch}={}){
  const {response,text}=await fetchWithProgress(url,{idleMs:10000,totalMs:120000,fetcher,init:{cache:force?'reload':'default'}});
  if(!response.ok)throw Object.assign(Error(`HTTP ${response.status}`),{status:response.status});
  const data=JSON.parse(text);if(!validSnapshot(data))throw Error('新聞資料格式不正確');
  return data;
}
