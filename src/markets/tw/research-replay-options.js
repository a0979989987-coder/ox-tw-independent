export const REPLAY_SPEEDS = Object.freeze([0.1, 0.2, 0.3, 0.5, 0.75, 1, 1.5, 2, 3, 4]);
// A full year plus the preceding 20-session momentum window. The larger
// archive is fetched on demand; the first market load stays compact.
export const REPLAY_HISTORY_LIMIT = 320;

export function replayPositionForDate(previousDays, position, nextDays) {
  const date = previousDays[Math.floor(position)]?.date;
  const index = nextDays.findIndex(day => day.date === date);
  return index < 0 ? 0 : Math.min(index + position % 1, Math.max(0, nextDays.length - 1));
}

export function replayOptionControls(speed) {
  return `<div class="twx-replay-options"><label><span>速度</span><select data-replay-speed aria-label="回放速度">${REPLAY_SPEEDS.map(value => `<option value="${value}" ${speed === value ? 'selected' : ''}>${value}x</option>`).join('')}</select></label></div>`;
}
