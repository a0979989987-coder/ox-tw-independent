export function projectSavings({initial,monthly,years,priceGrowth,dividendYield,reinvest=true}){
 for(const [key,value]of Object.entries({initial,monthly,years,priceGrowth,dividendYield}))if(typeof value!=='number'||!Number.isFinite(value))throw Error('請輸入有效數字');
 if(initial<0||initial>1e10||monthly<0||monthly>1e8||years<1||years>60||!Number.isInteger(years)||priceGrowth<=-100||priceGrowth>100||dividendYield<0||dividendYield>30)throw Error('請檢查金額、年數與報酬率範圍');
 let assets=initial,principal=initial,cash=0,dividends=0;const growth=(1+priceGrowth/100)**(1/12)-1,yieldMonth=dividendYield/1200,series=[{year:0,assets,principal,cash,total:assets,dividends:0}];
 for(let m=1;m<=years*12;m++){assets*=1+growth;const payout=assets*yieldMonth;dividends+=payout;if(reinvest)assets+=payout;else cash+=payout;assets+=monthly;principal+=monthly;if(m%12===0)series.push({year:m/12,assets,principal,cash,total:assets+cash,dividends});}
 return {...series.at(-1),monthlyIncome:assets*dividendYield/1200,series};
}
export function compareHoldings(a,b,allocation=.5){
 if(!a?.holdings?.length||!b?.holdings?.length)throw Error('請選擇兩檔具持股資料的 ETF');
 if(!Number.isFinite(allocation)||allocation<0||allocation>1)throw Error('配置比例須介於0到100%');
 const prepare=f=>{const m=new Map();for(const r of f.holdings){if(!r.symbol||!Number.isFinite(r.weight)||r.weight<0||m.has(r.symbol))throw Error('持股資料不完整');m.set(r.symbol,r);}return m;},am=prepare(a),bm=prepare(b);
 const sum=m=>[...m.values()].reduce((s,r)=>s+r.weight,0),totalA=sum(am),totalB=sum(bm);if(!(totalA>0&&totalB>0)||totalA>101||totalB>101)throw Error('股票權重總和異常');
 const combined=[...new Set([...am.keys(),...bm.keys()])].map(symbol=>{const x=am.get(symbol),y=bm.get(symbol),weightA=x?.weight||0,weightB=y?.weight||0;return {symbol,name:x?.name||y?.name||symbol,weightA,weightB,common:Math.min(weightA,weightB),normalizedCommon:Math.min(weightA/totalA,weightB/totalB)*100,portfolioWeight:allocation*weightA+(1-allocation)*weightB};}).sort((a,b)=>b.portfolioWeight-a.portfolioWeight);
 const shared=combined.filter(r=>r.weightA>0&&r.weightB>0).sort((a,b)=>b.common-a.common);
 return {shared,combined,overlap:shared.reduce((s,r)=>s+r.common,0),equityOverlap:shared.reduce((s,r)=>s+r.normalizedCommon,0),totalA,totalB,sameDate:a.date===b.date};
}
export function parseHoldingsCSV(text){
 const rows=text.trim().split(/\r?\n/).filter(Boolean);if(rows.length>1500)throw Error('最多可匯入1500筆');const out=[];
 for(const [i,line]of rows.entries()){const cells=line.split(/[,\t]/).map(s=>s.trim().replace(/^"|"$/g,''));if(i===0&&!/^\d{4,6}$/.test(cells[0]))continue;if(cells.length!==3||!/^\d{4,6}$/.test(cells[0]))throw Error(`第 ${i+1} 列需為「代號,名稱,權重%」`);const weight=Number(cells[2].replace('%',''));if(!/^\d+(?:\.\d+)?%?$/.test(cells[2])||!Number.isFinite(weight)||weight<0||weight>100)throw Error('權重需為0至100的百分比');out.push({symbol:cells[0],name:cells[1],weight});}
 if(!out.length||new Set(out.map(r=>r.symbol)).size!==out.length||out.reduce((s,r)=>s+r.weight,0)>100.5)throw Error('持股代號重複、無資料或總權重超過100%');return out;
}
