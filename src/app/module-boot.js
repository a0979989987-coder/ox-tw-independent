(() => {
  const boot=()=>import('../generated/runtime.js?v=tw-chart-20261007-tools2');
  globalThis.OXRuntimeReady=boot().catch(error=>{
    const host=document.getElementById('market-unavailable-card');host.textContent='台股工具暫時無法載入。';
    const button=document.createElement('button');button.textContent='重新連線';button.onclick=()=>location.reload();host.append(button);throw error;
  });
})();
