import { qualifyClassicRow, compareClassic, rankClassicTiers } from '../../core/classic.js?v=20261002-rank8';
export function rankChartRows(rows,{tab='all',tier='all',side='long',watchlist=new Set(),query='',strictTier=false}={}){
 const seen=new Set(),pool=rows.filter(r=>/^\d{4}$/.test(r.symbol)&&Number.isFinite(r.price)&&r.price>0&&!seen.has(r.symbol)&&seen.add(r.symbol));
 const q=query.trim().toLowerCase(),search=r=>!q||`${r.symbol} ${r.name}`.toLowerCase().includes(q);
 if(tab==='watch')return pool.filter(r=>watchlist.has(r.symbol)).filter(search);
 if(tab==='surge')return [...pool].filter(search).sort((a,b)=>(b.turnoverTwd||0)-(a.turnoverTwd||0)).slice(0,50);
 const direction=pool.flatMap(r=>{
  const signal=qualifyClassicRow(r,side,{observations:true});if(!signal)return [];
  return [{...r,classicSignal:signal,tier:signal.tier,setup:'OX 經典 · '+(signal.eligible?signal.stage:'同向觀察'),stage:signal.eligible?signal.stage:'同向觀察',
    oxScore:signal.qualityScore}];
 });
 return rankClassicTiers(direction,{side,compare:(a,b)=>compareClassic(a,b)||(b.turnoverTwd||0)-(a.turnoverTwd||0)})
  .filter(row=>tier==='all'||row.tier===tier.toUpperCase()).filter(search);
}
export function chartUniverse(state,snapshot,{asOf=null}={}){
 const facts=new Map((snapshot?.stocks||[]).map(r=>[r.symbol,{...r}]));
 for(const r of state?.data?.radar||[]){
  const date=r.dataDate||state?.data?.radarDataDate;
  // Candidate grades must keep the quotes from their verified classification
  // session. A newer quote feed must not erase every still-valid candidate.
  if(asOf&&date!==asOf||!asOf&&date&&snapshot?.date&&date<snapshot.date)continue;
  const merged={...facts.get(r.symbol),...r};for(const field of ['price','changePct','turnoverTwd'])if(!Number.isFinite(r[field]))merged[field]=facts.get(r.symbol)?.[field]??null;facts.set(r.symbol,merged);
 }
 return [...facts.values()];
}
