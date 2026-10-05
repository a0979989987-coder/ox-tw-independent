// All rates exposed to the UI are percentages. Cash flows occur at month end.
export const number = v => v === null || v === undefined || String(v).trim() === '' || !Number.isFinite(Number(String(v).replaceAll(',', ''))) ? null : Number(String(v).replaceAll(',', ''));
export function monthlyRate(annual) {
  if (!Number.isFinite(annual) || annual <= -100 || annual > 100) throw Error('年化報酬率須大於 -100% 且不超過 100%。');
  return Math.expm1(Math.log1p(annual / 100) / 12);
}
const checkMoney = v => { if (!Number.isFinite(v) || v < 0 || v > 1e10) throw Error('投入金額須介於 0 與 100 億元。'); };
export function futureValue(initial, monthly, annual, years) {
  checkMoney(initial); checkMoney(monthly);
  if (!Number.isFinite(years) || years < 0 || years > 110) throw Error('期間須介於 0 與 110 年。');
  const r = monthlyRate(annual), n = Math.round(years * 12), factor = Math.pow(1 + r, n);
  return initial * factor + monthly * (Math.abs(r) < 1e-12 ? n : Math.expm1(n * Math.log1p(r)) / r);
}
export function lifecycle({ age, retire, lifespan, initial, monthly, annual, retirementAnnual = annual }) {
  if (![age, retire, lifespan].every(Number.isInteger) || age < 18 || retire < age || lifespan <= retire || lifespan > 110) throw Error('請依序設定目前年齡、退休年齡及預估壽命（18–110 歲）。');
  const wealth = futureValue(initial, monthly, annual, retire - age), n = (lifespan - retire) * 12, r = monthlyRate(retirementAnnual);
  const withdrawal = Math.abs(r) < 1e-12 ? wealth / n : wealth * r / -Math.expm1(-n * Math.log1p(r));
  const points = [];
  for (let a = age; a <= lifespan; a++) {
    const m = (a - retire) * 12;
    const value = a <= retire ? futureValue(initial, monthly, annual, a - age) : Math.max(0, wealth * Math.pow(1 + r, m) - withdrawal * (Math.abs(r) < 1e-12 ? m : Math.expm1(m * Math.log1p(r)) / r));
    points.push({ x: a, value });
  }
  return { wealth, withdrawal, invested: initial + monthly * (retire - age) * 12, points };
}
export function compareHoldings(a, b) {
  const valid = x => x?.holdings?.length && x.holdings.every(h => h.code && Number.isFinite(h.weight) && h.weight >= 0);
  if (!valid(a) || !valid(b)) return null;
  const aggregate = rows => { const m = new Map(); for (const h of rows) m.set(h.code, { ...h, weight: (m.get(h.code)?.weight || 0) + h.weight }); return m; };
  const am = aggregate(a.holdings), bm = aggregate(b.holdings);
  const rows = [...am.values()].filter(h => bm.has(h.code)).map(h => ({ code: h.code, name: h.name, a: h.weight, b: bm.get(h.code).weight })).sort((x,y) => Math.min(y.a,y.b) - Math.min(x.a,x.b));
  const coverageA = [...am.values()].reduce((s,h) => s + h.weight, 0), coverageB = [...bm.values()].reduce((s,h) => s + h.weight, 0);
  if (coverageA > 100.5 || coverageB > 100.5) return null; // Leveraged exposures are not normalized into fake portfolio weights.
  const overlap = rows.reduce((s,h) => s + Math.min(h.a,h.b), 0);
  return { overlap: Math.min(100, overlap), rows, coverageA, coverageB, weightA: rows.reduce((s,h) => s+h.a,0), weightB: rows.reduce((s,h) => s+h.b,0), sameDate: !!a.date && a.date === b.date, complete: a.complete === true && b.complete === true };
}
export function portfolioHistory(details, allocations) {
  if (details.length !== allocations.length || details.some(x => !x?.monthly?.length) || Math.abs(allocations.reduce((s,v)=>s+v,0)-1)>1e-6) return null;
  const maps = details.map(d => new Map(d.monthly.map(p => [p.month, p.value])));
  const months = [...maps[0].keys()].filter(k => maps.every(m => m.has(k))).sort();
  if (months.length < 13) return null;
  const returns = [];
  for (let i=1;i<months.length;i++) {
    const a = new Date(months[i-1]+'-01T00:00:00Z'), b = new Date(months[i]+'-01T00:00:00Z');
    if ((b.getUTCFullYear()-a.getUTCFullYear())*12+b.getUTCMonth()-a.getUTCMonth() !== 1) return null;
    returns.push(maps.reduce((s,m,j)=>s+allocations[j]*(m.get(months[i])/m.get(months[i-1])-1),0));
  }
  const growth = returns.reduce((a,r)=>a*(1+r),1), mean=returns.reduce((s,r)=>s+r,0)/returns.length;
  return { annual: (growth**(12/returns.length)-1)*100, volatility: Math.sqrt(returns.reduce((s,r)=>s+(r-mean)**2,0)/(returns.length-1))*Math.sqrt(12)*100, start: months[0], end: months.at(-1), months: returns.length };
}
export const STRATEGIES = [
  { id:'global', name:'台美布局', description:'台灣與美國大型企業', stock:100, funds:[['0050',.5],['00646',.5]] },
  { id:'income', name:'月領高息', description:'分散配息月份；每月金額仍依公告', stock:100, funds:[['0056',.34],['00878',.33],['00919',.33]] },
  { id:'tech', name:'科技增值', description:'科技產業配置，波動較集中', stock:100, funds:[['0052',.5],['00662',.5]] },
  { id:'balanced', name:'股債平衡', description:'60% 股票・40% 債券', stock:60, funds:[['0050',.6],['00679B',.4]] },
  { id:'retire', name:'安心退休', description:'40% 股票・60% 債券，仍有市場風險', stock:40, funds:[['0050',.4],['00719B',.6]] }
];
export function matchesCategory(row, main, sub, today) {
  if(main==='stock' && row.asset!=='stock') return false;
  if(main==='bond' && row.asset!=='bond') return false;
  if(main==='hot' && sub==='new') return !!row.listingDate && (new Date(today)-new Date(row.listingDate))/86400000<=180;
  if(main==='hot' && sub==='active') return row.active;
  if (['all','volume','aum','holders','yield','return1y'].includes(sub)) return true;
  return row.tags?.includes(sub);
}
