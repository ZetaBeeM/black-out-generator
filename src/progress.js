/**
 * Which endings have been watched, kept in localStorage.
 *
 * This is what colours the picker: an ending seen through to the end is drawn in the
 * list's teal, one that hasn't in white. Only a full playback counts; see endPlayback.
 */
const KEY = 'blackout.watched.v1';

export function loadWatched() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return new Set(Array.isArray(list) ? list : []);
  } catch {
    return new Set(); // private mode, or junk under the key
  }
}

export function saveWatched(watched) {
  try {
    localStorage.setItem(KEY, JSON.stringify([...watched]));
  } catch {
    // storage being unavailable shouldn't take the app down with it
  }
}
