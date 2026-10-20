// A module that failed even under a fresh URL (error.oxReload, see
// load-tool-module.js) stays failed until the page reloads. Reload by itself
// once per build and tab session; after that, or when sessionStorage is
// unavailable (so a loop could not be ruled out), a button reloads.
const RELOAD_KEY='ox-tw-module-reload';
export const needsReload=error=>Boolean(error?.oxReload);
export function reloadOnce({storage,build,reload}={}){
  try{
    storage??=globalThis.sessionStorage;
    build??=globalThis.document?.querySelector('meta[name="ox-build"]')?.content||'source';
    if(!storage||storage.getItem(RELOAD_KEY)===build)return false;
    storage.setItem(RELOAD_KEY,build);
    (reload||(()=>globalThis.location.reload()))();
    return true;
  }catch{return false;}
}
const reloadPage=()=>globalThis.location.reload();
// Keep recovery usable even when the tool's stylesheet could not be loaded.
export function showToolLoadError(host,error,retry,{title:heading='工具暫時無法載入',autoReload=reloadOnce}={}) {
  host.replaceChildren();
  const box=document.createElement('div');box.className='ox-tool-error';
  box.setAttribute('role','status');
  box.style.cssText='display:grid;gap:12px;justify-items:center;padding:24px 16px;max-width:100%;box-sizing:border-box;overflow-wrap:anywhere';
  const title=document.createElement('p');title.textContent=heading;title.style.margin='0';
  const reload=needsReload(error);
  if(reload&&autoReload()){
    title.textContent='正在重新載入…';box.append(title);host.append(box);
    // Should the navigation not happen, fall back to the button.
    setTimeout(()=>{if(box.isConnected)showToolLoadError(host,error,retry,{title:heading,autoReload:()=>false});},8000);
    return;
  }
  const button=document.createElement('button');button.type='button';button.textContent=reload?'重新載入':'重新連線';
  button.style.cssText='font:inherit;color:inherit;background:transparent;border:1px solid currentColor;border-radius:12px;padding:10px 20px;min-height:44px';
  button.onclick=()=>{button.disabled=true;if(reload)reloadPage();else retry();};
  const details=document.createElement('details'),label=document.createElement('summary'),message=document.createElement('p');
  label.textContent='查看載入原因';
  message.textContent=`${error?.name||'Error'}：${String(error?.message||'未取得工具資料').slice(0,240)}`;
  details.append(label,message);box.append(title,button,details);host.append(box);
}
