/**
 * The game's ending SFX. One clip plays per line, starting as that line's words begin
 * forming. The clips are picked up front, before the schedule is built, since the schedule
 * carries their cues.
 *
 * A clip's length does not pace its line: see buildSchedule.
 */
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

// These two keep the game's own relative levels: the blip sits about level with a line
// sound, the dissolve at about half of one.
const PERIOD_SOUND = '/sound_effects/periods/period.mp3';
const DISSOLVE_SOUND = '/sound_effects/dissolve/dissolve.mp3';

// The "Select Text" screen's own two sounds: the wheel turning, and an ending being chosen.
// The move peaks at -13.6dB and the select at -8.1dB, which is their natural relation.
const CURSOR_MOVE_SOUND = '/sound_effects/cursor/move.mp3';
const CURSOR_SELECT_SOUND = '/sound_effects/cursor/select.mp3';

const FALLBACK_DURATION_MS = 4000; // if a clip's metadata won't load, don't wedge playback

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

/**
 * A clip out of a file the user picked, to stand in for the last line's sound.
 *
 * It lives on an object URL, which makes it a clip like any other: the schedule cues it, the
 * rAF loop plays it, and the exporter fetches and decodes it, all without knowing where it
 * came from. It also makes it **this session only** — the URL dies with the page, and there
 * is nothing here to save. Nothing about it is written to a saved ending or a back-up file.
 *
 * Unlike the game's clips, a bad file rejects rather than falling back to a nominal duration:
 * the user chose this one, so if it won't play they need telling.
 */
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

/** Frees a clip made by loadClipFromFile. The game's own clips have nothing to free. */
export function releaseClip(clip) {
  if (!clip?.custom) return;
  stopClip(clip);
  URL.revokeObjectURL(clip.src);
}

/** Loads every clip's metadata up front. Durations are needed before a schedule is built. */
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

/**
 * Picks a clip per line: the last line draws from final_lines, the rest from
 * normal_lines. At random, with the only rule being no clip twice in a row.
 */
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

/** Stops a clip and rewinds it, so a replay starts from the top. */
export function stopClip(clip) {
  if (!clip) return;
  clip.el.pause();
  clip.el.currentTime = 0;
}

/**
 * Starts a clip `offsetMs` into itself. The offset is what keeps sound and picture
 * together on resume: playback position is derived from elapsed time, so a clip that was
 * mid-way through when the user paused picks up where the animation did.
 */
export function playClip(clip, offsetMs = 0) {
  if (!clip) return;
  const offset = Math.max(0, offsetMs) / 1000;
  if (offset >= clip.el.duration) return;
  clip.el.currentTime = offset;
  const attempt = clip.el.play();
  // Blocked until the page has a user gesture, and a wheel event isn't one, so the
  // picker's first cursor blip can be refused. Swallow it rather than break playback.
  if (attempt?.catch) attempt.catch(() => {});
}
