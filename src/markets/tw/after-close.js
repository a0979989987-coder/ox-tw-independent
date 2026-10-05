// Follow official publication in Taipei time. Never synthesize a trading date.
export function afterCloseSlot(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Taipei', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23'}).formatToParts(now);
  const value = type => parts.find(p => p.type === type).value;
  const date = `${value('year')}-${value('month')}-${value('day')}`;
  const day = new Date(date+'T12:00:00Z').getUTCDay(), minutes = Number(value('hour'))*60+Number(value('minute'));
  if (day === 0 || day === 6 || minutes < 815) return null;
  return `${date}:${Math.floor((Math.min(minutes,1295)-815)/5)}`;
}
export function createAfterCloseRefresh(refresh, {active=()=>true, visible=()=>true, online=()=>true, now=()=>new Date(), setTimer=setTimeout, clearTimer=clearTimeout}={}) {
  let timer, running=false, pending=null, lastSlot=null;
  function check() {
    if (!running || !active() || !visible() || !online()) return Promise.resolve();
    const slot = afterCloseSlot(now());
    if (!slot || slot === lastSlot) return pending || Promise.resolve();
    if (pending) return pending;
    lastSlot=slot;
    pending=Promise.resolve().then(refresh).catch(()=>{lastSlot=null;}).finally(()=>{pending=null;});
    return pending;
  }
  function tick() {
    if (!running) return;
    check(); timer=setTimer(tick,60000);
  }
  return {check, start(){if(running)return;running=true;tick();}, stop(){running=false;clearTimer(timer);}};
}
