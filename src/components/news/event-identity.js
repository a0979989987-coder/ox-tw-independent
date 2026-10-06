import { CATEGORY_NAMES } from './config.js';
import { eventCategory } from './model.js';

const calendar = '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4m8-4v4M4 10h16"/>';
export const EVENT_ICON_PATHS = {
  macro: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  earnings: '<path d="M4 19V11m5 8V5m5 14v-7m5 7V8M3 20h18"/>',
  holiday: calendar,
  exchange: '<path d="M4 8h16m-4-4 4 4-4 4M20 16H4l4-4m-4 4 4 4"/>',
  dividend: '<circle cx="12" cy="12" r="9"/><path d="M15 8H10a2 2 0 0 0 0 4h4a2 2 0 0 1 0 4H9m3-10v12"/>',
  'dividend-preview': '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4m8-4v4M4 10h16m-9 4h6m-3-3v6"/>',
  payment: '<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M6 9v6m12-6v6"/>'
};
export function eventIdentityInfo(item) {
  const category = eventCategory(item);
  const country = item.country || (['bls-calendar','fed','sec','cftc'].includes(item.sourceId) ? '美國' : '');
  const flag = {美國:'🇺🇸',美国:'🇺🇸',US:'🇺🇸',USA:'🇺🇸',台灣:'🇹🇼',臺灣:'🇹🇼',日本:'🇯🇵',法國:'🇫🇷',德國:'🇩🇪',英國:'🇬🇧',歐元區:'🇪🇺'}[country];
  return { category, label: flag ? country : CATEGORY_NAMES[category] || '事件', flag,
    symbol: item.assets?.[0]?.symbol || item.symbols?.[0] || item.symbol || '',
    path: EVENT_ICON_PATHS[category] || calendar };
}
export function createEventIdentity(item, compact = false, doc = document) {
  const info = eventIdentityInfo(item), identity = doc.createElement('span');
  identity.className = 'oxn-event-icon' + (compact ? ' oxn-event-icon-compact' : '');
  identity.setAttribute('role','img');identity.setAttribute('aria-label', info.label);
  const fallback = () => { identity.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${info.path}</svg>`; };
  if (info.flag === '🇺🇸') {
    const img = doc.createElement('img');img.src = new URL('../../assets/flags/us.svg', import.meta.url).href;
    img.alt = '';img.width = compact ? 16 : 28;img.height = compact ? 12 : 20;
    img.addEventListener('error', fallback, {once:true});identity.append(img);
  } else if (info.flag) identity.textContent = info.flag;
  else fallback();
  return identity;
}
