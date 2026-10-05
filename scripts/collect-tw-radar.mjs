import {readFile,writeFile} from 'node:fs/promises';
import {getOfficialTWRadar} from '../api/v1/tw/providers/radar.js';
import {validRadarSnapshot} from '../src/markets/tw/radar-snapshot.js';
const priorDates=await Promise.all(['tw-radar.json','tw-research.json'].map(async file=>{
 try{const saved=JSON.parse(await readFile(new URL('../data/'+file,import.meta.url),'utf8'));return saved.data?.dataDate||saved.date||'';}catch{return '';}
}));
const minimumDate=priorDates.filter(date=>/^\d{4}-\d{2}-\d{2}$/.test(date)).sort().at(-1);
const data=await getOfficialTWRadar({includeSurveillance:true,market:'ALL',limit:2000,minimumDate});
const saved={savedAt:Date.now(),data};
if(!validRadarSnapshot(saved))throw Error('Official membership incomplete; retain previous radar snapshot');
await writeFile(new URL('../data/tw-radar.json',import.meta.url),JSON.stringify(saved));
console.log(JSON.stringify({date:data.dataDate,rows:data.radar.length,risk:data.modes.risk.length,disposal:data.modes.disposal.length,release:data.modes.release.length}));
