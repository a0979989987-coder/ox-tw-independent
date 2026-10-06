(() => {
  try {
    const choice=localStorage.getItem('ox-tw-independent-theme')||'dark';
    const resolved=choice==='light'||choice==='system'&&matchMedia('(prefers-color-scheme:light)').matches?'light':'dark';
    document.documentElement.style.colorScheme=resolved;
    if(localStorage.getItem('ox-tw-independent-live')==='0'){
      const style=document.createElement('style');style.id='tw-live-before-paint';style.textContent='.ox-live-shell{display:none!important}';document.head.append(style);
    }
  }catch{}
})();
