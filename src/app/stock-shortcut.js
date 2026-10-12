// Desktop type-to-open. Never intercept editing, IME, browser shortcuts or a modal.
export function canStartStockShortcut(event, {desktop, modalOpen}) {
  if (!desktop || modalOpen || event.defaultPrevented || event.isComposing || event.repeat ||
      event.ctrlKey || event.metaKey || event.altKey || !/^[0-9]$/.test(event.key)) return false;
  return !(event.composedPath?.() || [event.target]).some(node => node?.isContentEditable ||
    node?.matches?.('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="combobox"],[role="spinbutton"]'));
}

export function initStockShortcut(openStock) {
  const dialog = document.createElement('dialog');
  dialog.className = 'tw-stock-shortcut';
  dialog.setAttribute('aria-label', '輸入股票代號開啟雷達圖表');
  dialog.innerHTML = '<form method="dialog"><label for="tw-stock-code">股票代號</label><button type="button" data-close aria-label="取消股票切換">×</button><div><input id="tw-stock-code" inputmode="numeric" autocomplete="off" maxlength="4" pattern="[0-9]{4}" required placeholder="2330" aria-describedby="tw-stock-code-hint"><button type="submit">開啟圖表 ↗</button></div><small id="tw-stock-code-hint">輸入 4 碼後按 Enter · Esc 取消</small></form>';
  document.body.append(dialog);
  const input = dialog.querySelector('input');
  dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
  dialog.querySelector('form').addEventListener('submit', event => {
    event.preventDefault();
    if (!/^\d{4}$/.test(input.value)) return;
    const symbol = input.value; dialog.close(); openStock(symbol);
  });
  document.addEventListener('keydown', event => {
    if (!canStartStockShortcut(event, {desktop: matchMedia('(min-width:901px) and (pointer:fine)').matches,
      modalOpen: [...document.querySelectorAll('dialog[open],[aria-modal="true"]')].some(node =>
        !node.closest('[aria-hidden="true"],[inert],[hidden]') && node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden') || document.body.classList.contains('ox-control-open')})) return;
    event.preventDefault(); input.value = event.key; dialog.showModal(); input.focus(); input.setSelectionRange(1, 1);
  });
}
