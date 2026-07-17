const KEY = 'blackout.watched.v1';
export function loadWatched() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return new Set(Array.isArray(list) ? list : []);
  } catch {
    return new Set(); 
  }
}
export function saveWatched(watched) {
  try {
    localStorage.setItem(KEY, JSON.stringify([...watched]));
  } catch {
    
  }
}