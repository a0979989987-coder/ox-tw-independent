import { createETFRequester } from './request.js?v=20261005-load16';
const requests=new Map();
export const etfRequest=createETFRequester({rootUrl:new URL('../../../..',import.meta.url),
  getApiBase:async()=> (await import('../api.js')).getTWApiBase()});
export function rememberHistory(rows){for(const r of rows)if(!r.unavailable)requests.set(r.symbol,r);}
export const knownHistory=symbol=>requests.get(symbol);
