(() => {
  const root=document.documentElement;
  try {
    let choice=localStorage.getItem('ox-tw-independent-theme')||'dark';
    if(!['dark','light','midnight','system'].includes(choice))choice='dark';
    // Automatic follows the OS: dark → dark, light → platinum (never Midnight Ink).
    const palette=choice==='system'?(matchMedia('(prefers-color-scheme:light)').matches?'light':'dark'):choice;
    const resolved=palette==='light'?'light':'dark';
    root.style.colorScheme=resolved;
    if(palette==='midnight'){
      // Paint the Midnight Ink page colour before any stylesheet arrives;
      // theme-boot.js then activates the full (render-blocking) sheet.
      root.dataset.oxPalette='midnight';
      const style=document.createElement('style');style.id='ox-midnight-before-paint';
      style.textContent=':root[data-ox-palette="midnight"],:root[data-ox-palette="midnight"] body{background:#0A0E16!important;color:#ECE7DE}';
      document.head.append(style);
    }
    const meta=document.querySelector('meta[name="theme-color"]');
    if(meta)meta.content=palette==='light'?'#f4f4f5':palette==='midnight'?'#0A0E16':'#080b0f';
    if(localStorage.getItem('ox-tw-independent-live-choice-v2')!=='1'){
      const style=document.createElement('style');style.id='tw-live-before-paint';style.textContent='.ox-live-shell{display:none!important}';document.head.append(style);
    }
  }catch{const style=document.createElement('style');style.id='tw-live-before-paint';style.textContent='.ox-live-shell{display:none!important}';document.head.append(style);}
})();
