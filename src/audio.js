const NORMAL_LINE_SOUNDS = [
  '/sound_effects/normal_lines/42. Se Sys Ending Line 0.mp3',
  '/sound_effects/normal_lines/43. Se Sys Ending Line 1.mp3',
  '/sound_effects/normal_lines/44. Se Sys Ending Line 2.mp3',
  '/sound_effects/normal_lines/46. Se Sys Ending Line 4.mp3',
];
const FINAL_LINE_SOUNDS = [
  '/sound_effects/final_lines/52. Se Sys Ending Result 0.mp3',
  '/sound_effects/final_lines/53. Se Sys Ending Result 1.mp3',
  '/sound_effects/final_lines/54. Se Sys Ending Result 2.mp3',
  '/sound_effects/final_lines/55. Se Sys Ending Result 3.mp3',
  '/sound_effects/final_lines/56. Se Sys Ending Result 4.mp3',
];
const PERIOD_SOUND = '/sound_effects/periods/period.mp3';
const DISSOLVE_SOUND = '/sound_effects/dissolve/dissolve.mp3';

const CURSOR_MOVE_SOUND = '/sound_effects/cursor/move.mp3';
const CURSOR_SELECT_SOUND = '/sound_effects/cursor/select.mp3';
const FALLBACK_DURATION_MS = 4000; 
function loadClip(path) {
  return new Promise((resolve) => {
    const src = encodeURI(path);
    const el = new Audio(src);
    el.preload = 'auto';
    const done = (durationMs) => resolve({ src, el, duration: durationMs });
    el.addEventListener('loadedmetadata', () => done(el.duration * 1000), { once: true });
    el.addEventListener('error', () => done(FALLBACK_DURATION_MS), { once: true });
  });
}
export function loadClipFromFile(file) {
  return new Promise((resolve, reject) => {
    const src = URL.createObjectURL(file);
    const el = new Audio(src);
    el.preload = 'auto';
    el.addEventListener(
      'loadedmetadata',
      () => resolve({ src, el, duration: el.duration * 1000, name: file.name, custom: true }),
      { once: true },
    );
    el.addEventListener(
      'error',
      () => {
        URL.revokeObjectURL(src);
        reject(new Error(`${file.name} wouldn't play`));
      },
      { once: true },
    );
  });
}
export function releaseClip(clip) {
  if (!clip?.custom) return;
  stopClip(clip);
  URL.revokeObjectURL(clip.src);
}
export async function loadSoundBank() {
  const [normal, final, period, dissolve, move, select] = await Promise.all([
    Promise.all(NORMAL_LINE_SOUNDS.map(loadClip)),
    Promise.all(FINAL_LINE_SOUNDS.map(loadClip)),
    loadClip(PERIOD_SOUND),
    loadClip(DISSOLVE_SOUND),
    loadClip(CURSOR_MOVE_SOUND),
    loadClip(CURSOR_SELECT_SOUND),
  ]);
  return { normal, final, period, dissolve, cursor: { move, select } };
}
export function pickSounds(bank, lineCount) {
  const picks = [];
  let previous = null;
  for (let i = 0; i < lineCount; i++) {
    const pool = i === lineCount - 1 ? bank.final : bank.normal;
    const choices = pool.filter((clip) => clip.src !== previous);
    const clip = choices[Math.floor(Math.random() * choices.length)] ?? pool[0];
    picks.push(clip);
    previous = clip?.src ?? null;
  }
  return picks;
}

export function stopClip(clip) {
  if (!clip) return;
  clip.el.pause();
  clip.el.currentTime = 0;
}

export function playClip(clip, offsetMs = 0) {
  if (!clip) return;
  const offset = Math.max(0, offsetMs) / 1000;
  if (offset >= clip.el.duration) return;
  clip.el.currentTime = offset;
  const attempt = clip.el.play();
  
  if (attempt?.catch) attempt.catch(() => {});
}
