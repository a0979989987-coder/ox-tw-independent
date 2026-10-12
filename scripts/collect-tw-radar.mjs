import {readFile,writeFile} from 'node:fs/promises';
import {getOfficialTWRadar} from '../api/v1/tw/providers/radar.js';
import {validRadarSnapshot} from '../src/markets/tw/radar-snapshot.js';
let previousRadar;
const priorDates=await Promise.all(['tw-radar.json','tw-research.json'].map(async file=>{
 try{const saved=JSON.parse(await readFile(new URL('../data/'+file,import.meta.url),'utf8'));if(file==='tw-radar.json')previousRadar=saved.data;return saved.data?.dataDate||saved.date||'';}catch{return '';}
}));
const minimumDate=priorDates.filter(date=>/^\d{4}-\d{2}-\d{2}$/.test(date)).sort().at(-1);
let saved;
for (let attempt=0; attempt<2; attempt++) {
 const data=await getOfficialTWRadar({includeSurveillance:true,market:'ALL',limit:2000,minimumDate});
 saved={savedAt:Date.now(),data};
 if(validRadarSnapshot(saved))break;
 // Successful exchange feeds remain cached; retry only the missing sources.
 console.warn('Official membership incomplete',JSON.stringify({attempt:attempt+1,date:data.dataDate,failedSources:Object.entries(data.modesMeta?.sources||{}).filter(([,s])=>!s.ok).map(([name])=>name)}));
}
if(!validRadarSnapshot(saved))throw Error('Official membership incomplete after retry; retain previous radar snapshot');
// Company metadata can time out independently from valid official quotes.
// Keep previously verified industry labels without substituting old prices.
const identities=new Map((previousRadar?.radar||[]).map(row=>[`${row.market}:${row.symbol}`,row]));
const identity=row=>{const previous=identities.get(`${row.market}:${row.symbol}`);return previous?{...row,industry:row.industry||previous.industry||'',theme:row.theme||previous.theme||''}:row;};
saved.data={...saved.data,radar:saved.data.radar.map(identity),modes:Object.fromEntries(Object.entries(saved.data.modes).map(([mode,rows])=>[mode,rows.map(identity)]))};
const {data}=saved;
await writeFile(new URL('../data/tw-radar.json',import.meta.url),JSON.stringify(saved));
console.log(JSON.stringify({date:data.dataDate,rows:data.radar.length,risk:data.modes.risk.length,disposal:data.modes.disposal.length,release:data.modes.release.length}));
