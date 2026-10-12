import {withDeadline} from '../resource-deadline.js';
export function createNewsLoader(fetcher = fetch, timeoutMs = 10000) {
  return async function loadNews(url, {force = false} = {}) {
    let error;
    for(let attempt=0;attempt<2;attempt++) {
      try {
        return await withDeadline(async signal=>{
          const response=await fetcher(url,{signal,cache:force||attempt?'reload':'default'});
          if(!response.ok)throw Object.assign(Error(`HTTP ${response.status}`),{status:response.status});
          const data=await response.json();
          if(data.schemaVersion!==1||!Array.isArray(data.news)||!Array.isArray(data.events))throw Error('新聞資料格式不正確');
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
