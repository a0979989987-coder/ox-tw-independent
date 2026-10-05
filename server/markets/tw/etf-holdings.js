// Decode only Nuxt's literal data serialization. Never evaluate publisher JavaScript.
export function parseLiteral(text,vars={}){
 let i=0,depth=0;const ws=()=>{while(/\s/.test(text[i]||'')&&i<text.length)i++;};
 function value(){ws();if(++depth>100)throw Error('Data nesting limit');let out,ch=text[i];
 if(ch==='"'||ch==="'"){const quote=ch;let s='';i++;while(i<text.length){const c=text[i++];if(c===quote){out=s;break;}if(c==='\\'){const e=text[i++];if(e==='u'){s+=String.fromCharCode(parseInt(text.slice(i,i+4),16));i+=4;}else if(e==='x'){s+=String.fromCharCode(parseInt(text.slice(i,i+2),16));i+=2;}else s+=({n:'\n',r:'\r',t:'\t',b:'\b',f:'\f'}[e]??e);}else s+=c;}if(out===undefined)throw Error('Unclosed string');}
 else if(ch==='['){i++;out=[];ws();while(text[i]!==']'){out.push(value());ws();if(text[i]!==',')break;i++;}if(text[i++]!==']')throw Error('Invalid array');}
 else if(ch==='{'){i++;out=Object.create(null);ws();while(text[i]!=='}'){ws();let key;if(/["']/.test(text[i]))key=value();else{const m=text.slice(i).match(/^[\w$]+/);if(!m)throw Error('Invalid key');key=m[0];i+=key.length;}ws();if(text[i++]!==':')throw Error('Invalid property');out[key]=value();ws();if(text[i]!==',')break;i++;}if(text[i++]!=='}')throw Error('Invalid object');}
 else{const m=text.slice(i).match(/^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i);if(m){out=Number(m[0]);i+=m[0].length;}else{const word=text.slice(i).match(/^[A-Za-z_$][\w$]*/)?.[0];if(!word)throw Error('Unsupported data token');i+=word.length;if(word==='void'){const z=text.slice(i).match(/^\s+0/);if(!z)throw Error('Invalid undefined value');i+=z[0].length;out=null;}else if(word==='Array'){const a=text.slice(i).match(/^\((\d+)\)/);if(!a||Number(a[1])>10000)throw Error('Invalid data array');out=Array(Number(a[1])).fill(null);i+=a[0].length;}else if(word==='null')out=null;else if(word==='true')out=true;else if(word==='false')out=false;else if(Object.hasOwn(vars,word))out=vars[word];else throw Error('Unknown data identifier: '+word);}}
 depth--;return out;
 }
 const out=value();ws();if(i!==text.length)throw Error('Unexpected data expression');return out;
}
export function parseYuanta(html,symbol,sourceUrl){
 const serial=html.match(/window\.__NUXT__=(\(function\([\s\S]*?)<\/script>/)?.[1];if(!serial)throw Error('ETF data serialization missing');
 const m=serial.match(/^\(function\(([^)]*)\)\{[\s\S]*?;?return\s*([\s\S]*)\}\(([\s\S]*)\)\);?\s*$/);if(!m)throw Error('Unsupported ETF data serialization');
 const keys=m[1].split(','),values=parseLiteral('['+m[3]+']'),vars=Object.fromEntries(keys.map((k,i)=>[k,values[i]])),data=parseLiteral(m[2],vars);
 const fund=data.data?.find(d=>d.weightData)?.weightData;if(fund?.PCF?.markcd!==symbol)throw Error('ETF symbol mismatch');
 const rawDate=String(fund.PCF.trandate),date=/^\d{8}$/.test(rawDate)?rawDate.replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3'):null;if(!date)throw Error('ETF holdings date missing');
 const holdings=(fund.FundWeights?.StockWeights||[]).map(r=>({symbol:String(r.code),name:String(r.name),weight:Number(r.weights)}));
 if(holdings.length<10||holdings.some(r=>!/^\d{4,6}$/.test(r.symbol)||!Number.isFinite(r.weight)||r.weight<0)||new Set(holdings.map(r=>r.symbol)).size!==holdings.length)throw Error('Invalid ETF holdings');
 const stockWeight=holdings.reduce((s,r)=>s+r.weight,0);if(stockWeight<50||stockWeight>101)throw Error('Incomplete or leveraged ETF holdings');
 return {symbol,name:fund.PCF.fundname,date,holdings,stockWeight,source:'元大投信',sourceUrl,scope:'完整股票部位（不含現金、期貨與其他資產）',retrievedAt:new Date().toISOString()};
}
