import { segments } from './research-ui.js';
import { researchDialog } from './research-detail.js';

export const settingsIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h18M3 17h18M8 3v8M16 13v8"/></svg>';
export const trailIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 18c6 0 3-12 9-12s3 12 9 12"/><circle cx="21" cy="18" r="2"/></svg>';
export function settingsButton() {
  return `<button type="button" class="twx-chart-settings" data-chart-settings aria-label="板塊輪動設定" aria-haspopup="dialog" title="板塊輪動設定">${settingsIcon}</button>`;
}
function contents(prefs, mode) {
  return `<div class="twx-setting-row"><strong>觀察範圍</strong>${segments('scope', [['all', '板塊'], ['watch', '自選']], prefs.scope)}</div>
    <div class="twx-setting-row"><strong>圖表模式</strong>${segments('mode', [['momentum', '資金動向'], ['day', '當日價量']], mode)}</div>
    <div class="twx-setting-row"><strong>泡泡數量</strong>${segments('density', [['all', '全部板塊'], ['top', '金額前 10']], prefs.density)}<small>顯示目前範圍內買賣超至少十億元的板塊。</small></div>`;
}
export function showRotationSettings(prefs, mode, apply, onClose) {
  const node = researchDialog('板塊輪動設定', { className: 'twx-rotation-settings', onClose });
  const body = node.querySelector('.twx-detail-content');
  body.innerHTML = contents(prefs, mode);
  node.addEventListener('click', event => {
    const button = event.target.closest('[data-scope], [data-mode], [data-density]');
    if (!button) return;
    const key = ['scope', 'mode', 'density'].find(key => button.dataset[key]);
    apply(key, button.dataset[key]);
    if (key === 'mode') mode = button.dataset.mode;
    // Preserve the window and its focused control while the chart rebuilds.
    const group = button.closest('.twx-segments'), buttons = [...group.querySelectorAll('button')];
    group.style.setProperty('--active', buttons.indexOf(button));
    buttons.forEach(b => b.setAttribute('aria-pressed', String(b === button)));
  });
  return node;
}
