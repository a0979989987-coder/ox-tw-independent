// Each input has one explicit unit and predicate. Missing data never passes a rule.
const n=(id,label,metric,op,unit='',extra={})=>({id,label,metric,op,unit,type:'number',...extra});
const b=(id,label,extra={})=>({id,label,metric:id,type:'boolean',...extra});
const pending='需累積完整歷史資料';
export const GROUPS=[
 {id:'value',name:'估值與配息',fields:[n('yieldMin','殖利率下限','yield','gte','%'),n('yieldMax','殖利率上限','yield','lte','%'),n('peMin','P/E 下限','pe','gte','倍'),n('peMax','P/E 上限','pe','lte','倍'),n('pbMax','P/B 上限','pb','lte','倍'),n('pegMax','PEG 上限','peg','lte','倍',{note:'需單季EPS年增率'}),n('psMax','P/S 上限','ps','lte','倍',{note:'需完整近12月營收'}),n('dividendYears','連續配息年數','dividendYears','gte','年',{note:pending}),n('payoutMin','配息率下限','payout','gte','%',{note:'需同年度EPS與股利'})]},
 {id:'growth',name:'成長與獲利',fields:[n('grossMin','毛利率','grossMargin','gte','%'),n('operatingMin','營益率','operatingMargin','gte','%'),n('netMin','淨利率','netMargin','gte','%'),n('epsMin','季 EPS','eps','gte','元',{note:'需單季完整財報'}),n('epsYoYMin','季 EPS YoY','epsYoY','gte','%',{note:pending}),n('revenueYoYMin','月營收 YoY','revenueYoY','gte','%'),n('revenueMoMMin','月營收 MoM','revenueMoM','gte','%'),n('revenueMin','月營收','revenue','gte','億元'),n('epsStreak','連續正季 EPS','epsStreak','gte','季',{note:pending}),n('revenueStreak','連續正營收 YoY','revenueStreak','gte','月',{note:pending}),n('luvai','LUVAI 分數','luvai','gte','',{min:-1,max:1,note:'第三方專有評分，尚未取得授權資料'})]},
 {id:'flow',name:'籌碼',fields:[n('foreign5','5日外資買賣超','foreign5','gte','張',{note:'需完整5個交易日'}),n('trust5','5日投信買賣超','trust5','gte','張',{note:'需完整5個交易日'}),n('dealer5','5日自營商買賣超','dealer5','gte','張',{note:'需完整5個交易日'}),n('foreignRatio','外資持股比例','foreignRatio','gte','%'),n('foreignStreak','外資連買','foreignStreak','gte','日',{note:pending}),n('foreign1','當日外資買賣超','foreign1','gte','張'),n('trust1','當日投信買賣超','trust1','gte','張'),n('dealer1','當日自營商買賣超','dealer1','gte','張'),b('institutionsBuy','三大法人同步買（當日）'),b('institutionsBuy5','三大法人同步買（5日）',{note:pending})]},
 {id:'technical',name:'均線與股價位置',fields:[b('above5','站上5日均線'),b('above20','站上20日均線'),b('above60','站上季線（60日）'),b('above240','站上年線（240日）'),b('ma20Rising','MA20 上升中'),b('breakout20','4週突破（前20日高點）'),b('newLow20','4週新低（前20日低點）'),b('bullMAs','4均線多頭排列'),n('high52Distance','距52週高點','high52Distance','lte','%',{note:'需完整52週資料'}),n('low52Distance','距52週低點','low52Distance','gte','%',{note:'需完整52週資料'})]},
 {id:'size',name:'規模與股價',fields:[n('capMin','市值下限','marketCap','gte','億元'),n('capMax','市值上限','marketCap','lte','億元'),n('priceMin','股價下限','price','gte','元'),n('priceMax','股價上限','price','lte','元'),n('turnoverMin','當日成交金額','turnover','gte','億元')]},
 {id:'quality',name:'5年品質',fields:[n('epsCagr','EPS 5Y CAGR','epsCagr','gte','%',{note:pending}),n('roe5','5Y ROE 平均','roe5','gte','%',{note:pending})]},
 {id:'momentum',name:'動能與量能',fields:[n('volumeRatioMin','量比（當日／前20日均量）','volumeRatio','gte','倍'),n('volumeRatioMax','量比上限','volumeRatio','lte','倍'),n('return5Min','5日漲幅下限','return5','gte','%'),n('return5Max','5日漲幅上限','return5','lte','%'),n('return20Min','20日漲幅','return20','gte','%'),n('volume5','5MA 量','volume5','gte','張'),n('volumeMin','當日成交量','volume','gte','張'),b('rebound','跌深反彈（前5日跌3%・今漲1%）'),b('consolidation','量縮整理（量比<0.8・20日振幅<15%）')]},
 {id:'rating',name:'波動與評級',fields:[n('amplitudeMax','20日振幅','amplitude20','lte','%'),n('volatilityMax','20日報酬標準差','volatility20','lte','%'),n('technicalScore','技術分','technicalScore','gte','',{min:-1,max:1,note:'評分來源尚未提供'}),n('fundamentalScore','基本面分','fundamentalScore','gte','',{min:-1,max:1,note:'評分來源尚未提供'}),n('flowScore','籌碼分','flowScore','gte','',{min:-1,max:1,note:'評分來源尚未提供'}),{id:'rating',label:'Rating 評級',metric:'rating',type:'rating',note:'評級來源尚未提供'}]}
];
export const FIELDS=GROUPS.flatMap(g=>g.fields), FIELD_MAP=Object.fromEntries(FIELDS.map(f=>[f.id,f]));
export const CATEGORIES=[['value','價值派',7],['allocation','配置派',3],['growth','成長派',5],['momentum','動能派',6],['emerging','新興市場派',2],['taiwan','台灣派',4]];
const p=(id,category,name,spirit,conditions)=>({id,category,name,spirit,conditions});
export const PRESETS=[
 p('graham','value','Benjamin Graham','安全邊際・內在價值',{peMax:15,pbMax:1.5,yieldMin:2,netMin:0}),
 p('buffett','value','Warren Buffett','優質企業・穩定獲利',{grossMin:20,operatingMin:10,netMin:10,peMax:25,yieldMin:1}),
 p('munger','value','Charlie Munger','優質生意・合理價格',{grossMin:30,operatingMin:15,netMin:10,revenueYoYMin:0,peMax:30}),
 p('lynch','value','Peter Lynch','合理價格・成長',{pegMax:1,epsYoYMin:15,marketCapMax:2000}),
 p('marks','value','Howard Marks','風險意識・估值紀律',{peMax:18,pbMax:2,yieldMin:2,amplitudeMax:25}),
 p('lilu','value','Li Lu','價值・競爭優勢',{grossMin:25,netMin:10,peMax:20,revenueYoYMin:5}),
 p('cheah','value','Cheah Cheng Hye','亞洲價值・配息',{peMax:15,pbMax:2,yieldMin:3,netMin:0}),
 p('dalio','allocation','Ray Dalio','風險平衡・大型穩定',{capMin:500,volatilityMax:2.5,yieldMin:2,netMin:0}),
 p('bogle','allocation','Jack Bogle','低成本・長期持有',{capMin:1000,yieldMin:1,volatilityMax:3}),
 p('malkiel','allocation','Burton Malkiel','多元配置・長期紀律',{capMin:500,netMin:0,yieldMin:1,volatilityMax:3}),
 p('wood','growth','Cathie Wood','創新・高速成長',{revenueYoYMin:30,revenueMoMMin:0,return20Min:0}),
 p('thiel','growth','Peter Thiel','獨特優勢・高毛利',{grossMin:40,operatingMin:15,revenueYoYMin:15}),
 p('paul','growth','Paul Graham','早期成長・營收加速',{revenueYoYMin:25,revenueMoMMin:10,capMax:500}),
 p('wilson','growth','Fred Wilson','營收成長・獲利引擎',{revenueYoYMin:20,netMin:5,revenueMoMMin:0}),
 p('gurley','growth','Bill Gurley','規模效應・高毛利',{grossMin:30,revenueYoYMin:20,operatingMin:10}),
 p('livermore','momentum','Jesse Livermore','趨勢突破・順勢而為',{breakout20:true,volumeRatioMin:1.5,return5Min:0}),
 p('oneil','momentum','William O’Neil','成長・突破・量能',{epsYoYMin:25,breakout20:true,volumeRatioMin:1.5,above20:true}),
 p('darvas','momentum','Nicolas Darvas','箱型突破・動能操作',{breakout20:true,ma20Rising:true,volumeRatioMin:1.2}),
 p('jones','momentum','Paul Tudor Jones','趨勢・風險控制',{bullMAs:true,volumeRatioMin:1,amplitudeMax:25}),
 p('simons','momentum','Jim Simons','量化條件參考',{return5Min:1,volumeRatioMin:1.1,volatilityMax:3}),
 p('druck','momentum','Stanley Druckenmiller','趨勢・相對強勢',{above20:true,above60:true,return20Min:5,volumeRatioMin:1}),
 p('mobius','emerging','Mark Mobius','價值・中小型成長',{peMax:18,yieldMin:2,capMax:1000}),
 p('rogers','emerging','Jim Rogers','循環・低估值',{peMax:15,pbMax:1.5,capMin:100,yieldMin:2}),
 p('chen','taiwan','陳重銘','存股・配息・穩定',{yieldMin:4,capMin:300,netMin:0,peMax:20}),
 p('age','taiwan','阿格力','生活消費・持續成長',{revenueYoYMin:5,netMin:5,grossMin:20,peMax:25}),
 p('lei','taiwan','雷浩斯','價值・財務品質',{peMax:20,netMin:10,grossMin:20,yieldMin:2,pbMax:3}),
 p('99','taiwan','99 喵','短線動能・量價',{return5Min:3,volumeRatioMin:1.5,institutionsBuy:true,above20:true})
].map(x=>({...x,conditions:Object.fromEntries(Object.entries(x.conditions).map(([k,v])=>[k==='marketCapMax'?'capMax':k,v]))}));
export const QUICK=[
 p('income','','高殖利率定存股','',{yieldMin:4,peMax:20,netMin:0}),p('peg','','便宜成長 PEG<1','',{pegMax:1,epsYoYMin:15}),p('quiet','','量縮整理','',{consolidation:true}),p('institution','','法人熱買','',{institutionsBuy:true}),p('trend','','均線多頭','',{above5:true,above20:true,above60:true,ma20Rising:true}),p('revenue','','營收成長','',{revenueYoYMin:15,revenueMoMMin:0}),p('value','','低估值高品質','',{peMax:15,pbMax:2,netMin:10}),p('breakout','','突破觀察','',{breakout20:true,volumeRatioMin:1.2})
];
