// The previous key was written as '1' even when users never enabled LIVE.
// Only a choice made with the corrected control counts as an opt-in.
export const LIVE_PREFERENCE_KEY = 'ox-tw-independent-live-choice-v2';
export function readLivePreference(storage) {
  try { return (storage ?? globalThis.localStorage)?.getItem(LIVE_PREFERENCE_KEY) === '1'; } catch { return false; }
}
