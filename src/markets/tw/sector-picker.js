import { SECTOR_GROUPS, SECTOR_DEFINITIONS } from './sector-taxonomy.js';
import { escape } from './research-ui.js';

export function sectorPickerList({ selectedSectors = [], pickerQuery = '', openGroups = [] } = {}) {
  const chosen = new Set(selectedSectors), query = pickerQuery.trim().toLowerCase();
  return SECTOR_GROUPS.map(group => {
    const members = SECTOR_DEFINITIONS.filter(sector => sector.group === group.name);
    const visible = members.filter(sector => !query || `${group.name} ${sector.name}`.toLowerCase().includes(query));
    if (!visible.length) return '';
    const count = members.filter(sector => chosen.has(sector.name)).length;
    return `<details data-sector-disclosure="${escape(group.name)}" ${query || openGroups.includes(group.name) ? 'open' : ''}><summary><span>${escape(group.name)}</span><small>${group.count}</small></summary><label class="twx-sector-group-check"><input type="checkbox" data-sector-group="${escape(group.name)}" ${count === members.length ? 'checked' : ''} aria-label="選取整組${escape(group.name)}" ${count && count < members.length ? 'data-mixed' : ''}>整組選取${count ? ` · ${count}` : ''}</label><div class="twx-sector-picker-items">${visible.map(sector => `<label><input type="checkbox" data-sector-choice="${escape(sector.name)}" ${chosen.has(sector.name) ? 'checked' : ''}><span>${escape(sector.name)}</span></label>`).join('')}</div></details>`;
  }).join('') || '<div class="twx-empty">沒有符合的板塊</div>';
}

export function sectorPicker(prefs) {
  return `<div class="twx-sector-picker-wrap"><button type="button" data-sector-picker aria-expanded="${prefs.pickerOpen}" aria-controls="twx-sector-picker">${prefs.selectedSectors.length ? `已選 ${prefs.selectedSectors.length}` : '選板塊'} ▾</button><div class="twx-sector-picker" id="twx-sector-picker" ${prefs.pickerOpen ? '' : 'hidden'}><div class="twx-sector-market"><span>市場</span><select data-market aria-label="市場範圍" ${prefs.replayIndex !== null ? 'disabled title="歷史回放僅提供全市場產業資料"' : ''}><option value="ALL" ${prefs.market === 'ALL' ? 'selected' : ''}>全部</option><option value="TWSE" ${prefs.market === 'TWSE' ? 'selected' : ''}>上市</option><option value="TPEX" ${prefs.market === 'TPEX' ? 'selected' : ''}>上櫃</option></select></div><input type="search" data-sector-search aria-label="搜尋板塊分類" placeholder="搜尋板塊…" value="${escape(prefs.pickerQuery)}"><div class="twx-sector-picker-bar"><span>已選 <b data-sector-selected-count>${prefs.selectedSectors.length}</b> 個板塊</span><button type="button" data-sector-all>全選</button><button type="button" data-sector-clear>清除</button></div><div class="twx-sector-picker-list">${sectorPickerList(prefs)}</div></div></div>`;
}
