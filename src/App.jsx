import { useEffect, useMemo, useRef, useState } from 'react';
import { buildLayout, drawFrame, fullRevealState } from './render.js';
import { buildSchedule, computeRevealState } from './animate.js';
import { buildParticlePlan } from './particles.js';
import { loadSoundBank, loadClipFromFile, releaseClip, pickSounds, playClip, stopClip } from './audio.js';
import { exportVideo, canExportVideo } from './export.js';
import { THEMES, DEFAULT_THEME } from './themes.js';
import EndingPicker from './EndingPicker.jsx';
import EndingPlayback from './EndingPlayback.jsx';
import TrueEnding from './TrueEnding.jsx';
import Confirm from './Confirm.jsx';
import { loadWatched, saveWatched } from './progress.js';
import { loadCustom, saveCustom, updateCustom, deleteCustom, exportCustom, importCustom } from './customEndings.js';
import ENDINGS from './endings.json';

let nextId = 0;
const makeEntry = (text = '', red = false) => ({ id: nextId++, text, red });

// playback is a 16:9 window the camera pans down the chain, like the game screen. the
// static frame and the PNG export are the whole chain at once instead.
const viewportHeightFor = (width) => Math.round((width * 9) / 16);


const DEFAULT_ENTRIES = [
  makeEntry('Slash your wrists'),
  makeEntry('Pass out but remain alive'),
  makeEntry("Get processed by Shiroyabu at Kamui's processing place"),
  makeEntry('Go to Hell'),
  makeEntry('Be reborn as Kamui', true),
];

export default function App() {
  const [entries, setEntries] = useState(DEFAULT_ENTRIES);
  // 26px on a 1024 canvas is the same text-to-frame ratio the game uses (~48px at 1080p)
  const [fontSize, setFontSize] = useState(26);
  const [canvasWidth, setCanvasWidth] = useState(1024);
  const [textColor, setTextColor] = useState('#cccccc');
  // the game's final line is a saturated red, not a brick one: its lit core is around
  // #e01e20, so the default keeps that hue and sits deeper
  const [redColor, setRedColor] = useState('#a01a20');
  const [isPlaying, setIsPlaying] = useState(false);
  const [fontReady, setFontReady] = useState(false);
  const [exportProgress, setExportProgress] = useState(null); // null = not exporting
  const [themeIndex, setThemeIndex] = useState(DEFAULT_THEME);
  // The flow is the game's: pick an ending, watch it play to an empty screen, and only then
  // does the editor exist. Reopening the picker runs the same three steps again. 'trueend'
  // is the fourth stage, which the hundredth ending falls straight into.
  const [stage, setStage] = useState('picker'); // | 'playing' | 'editor' | 'trueend'
  const [watched, setWatched] = useState(loadWatched);
  const [custom, setCustom] = useState(loadCustom); // the player's own endings; not part of the set
  const [loaded, setLoaded] = useState(null); // the ending the entries came from, if any
  const [asking, setAsking] = useState(false); // the save-data question is up
  const [saved, setSaved] = useState(false); // the chain just went to the custom deck
  const [source, setSource] = useState(null); // the custom ending this chain is, if it is one
  const [notice, setNotice] = useState(null); // what the deck just did (or failed to do), briefly
  // reordering: `dragId` is the line being dragged, `dropAt` the insertion point the rule is
  // drawn at (see startDrag)
  const [dragId, setDragId] = useState(null);
  const [dropAt, setDropAt] = useState(null);
  const listRef = useRef(null);
  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const layoutRef = useRef(null);
  const scheduleRef = useRef(null);
  const particlePlanRef = useRef(null);
  const startPerfRef = useRef(0);
  const elapsedAtPauseRef = useRef(0);
  const soundBankRef = useRef(null);
  const [soundBank, setSoundBank] = useState(null); // the game's clips, as loaded (see `bank`)
  const [finalSound, setFinalSound] = useState(null); // the user's own last-line sound, if they picked one
  const [soundError, setSoundError] = useState(null); // a file that wouldn't play
  const nextCueRef = useRef(0);
  const importRef = useRef(null); // the hidden file input behind "Import"
  const soundInputRef = useRef(null); // the hidden file input behind the final-line sound

  // memoized so its identity is stable across renders: EndingPlayback keys its whole
  // playback effect on it, and a fresh object every render would restart the ending
  const colors = useMemo(() => ({ textColor, redColor }), [textColor, redColor]);
  const hasLines = entries.some((e) => e.text.trim()); // an empty chain is nothing to save
  const exporting = exportProgress !== null;
  const videoSupported = canExportVideo();
  const viewportHeight = viewportHeightFor(canvasWidth);
  const theme = THEMES[themeIndex];
  const cycleTheme = () => setThemeIndex((i) => (i + 1) % THEMES.length);
  // The editor stays mounted through the other stages, just hidden, so its preview canvas
  // is always there for the static frame to be drawn onto. Unmount it and the draw effect
  // fires against a null ref while the ending plays, and the preview comes up blank.
  const editing = stage === 'editor';

  // The canvas measures and draws with the real webfont, so wait for it before the first
  // render: measureText silently falls back to another font if called too early, and every
  // layout comes out the wrong size.
  useEffect(() => {
    document.fonts.load('32px DotGothic16').then(() => setFontReady(true));
  }, []);

  // The clips' durations are needed before a schedule can be built, so load their metadata
  // up front.
  //
  // The bank lands in state as well as in the ref. The ref is what the rAF loop and the
  // exporter read, but the picker takes its cursor sounds as a prop, and a ref filled in
  // asynchronously re-renders nothing: the picker would hold an undefined clip and stay
  // silent until some other state change happened to re-render it.
  useEffect(() => {
    let live = true;
    loadSoundBank().then((loaded) => live && setSoundBank(loaded));
    return () => {
      live = false;
    };
  }, []);

  /**
   * The bank everything actually plays from.
   *
   * A sound the user brought is swapped in as the *only* clip the final-line pool holds, so
   * pickSounds picks it for the last line the way it would pick one of the game's. Nothing
   * downstream — the schedule's cues, the rAF loop, the exporter — knows the difference, and
   * nothing about it reaches a saved ending: it is in this bank and nowhere else.
   */
  const bank = useMemo(
    () => (soundBank && finalSound ? { ...soundBank, final: [finalSound] } : soundBank),
    [soundBank, finalSound],
  );

  // the rAF loop and the exporter read the bank from a ref, out of render
  useEffect(() => {
    soundBankRef.current = bank;
  }, [bank]);

  // A clip the user replaced is freed once nothing holds it: the swap already cancelled
  // playback (below), so no schedule is still cueing it.
  useEffect(() => () => releaseClip(finalSound), [finalSound]);

  const chooseFinalSound = async (file) => {
    if (!file) return;
    try {
      setFinalSound(await loadClipFromFile(file));
      setSoundError(null);
    } catch (err) {
      setSoundError(err.message);
    }
  };

  const silence = () => {
    scheduleRef.current?.cues.forEach(({ clip }) => stopClip(clip));
    nextCueRef.current = 0;
  };

  // Any edit interrupts playback and falls back to the fully-revealed static frame. Changing
  // the final-line sound counts: the schedule holds the clips it was built with, so it has
  // to be rebuilt (which the next play does) before the new sound is heard.
  useEffect(() => {
    cancelAnimationFrame(rafRef.current);
    silence();
    elapsedAtPauseRef.current = 0;
    setIsPlaying(false);
  }, [entries, fontSize, canvasWidth, textColor, redColor, finalSound]);

  useEffect(() => {
    if (isPlaying || !canvasRef.current || !fontReady) return;
    const ctx = canvasRef.current.getContext('2d');
    const layout = buildLayout(ctx, entries, canvasWidth, fontSize);
    drawFrame(canvasRef.current, layout, colors, fullRevealState(layout));
  }, [entries, fontSize, canvasWidth, textColor, redColor, isPlaying, fontReady]);

  useEffect(
    () => () => {
      cancelAnimationFrame(rafRef.current);
      scheduleRef.current?.cues.forEach(({ clip }) => stopClip(clip));
    },
    [],
  );

  const tick = () => {
    const elapsed = performance.now() - startPerfRef.current;
    const schedule = scheduleRef.current;
    const state = computeRevealState(layoutRef.current, schedule, elapsed);
    drawFrame(canvasRef.current, layoutRef.current, colors, state, particlePlanRef.current, schedule.viewportHeight);

    const { cues } = schedule;
    while (nextCueRef.current < cues.length && elapsed >= cues[nextCueRef.current].time) {
      const cue = cues[nextCueRef.current];
      playClip(cue.clip, elapsed - cue.time);
      nextCueRef.current += 1;
    }

    if (elapsed < schedule.totalDuration) {
      rafRef.current = requestAnimationFrame(tick);
    } else {
      silence();
      setIsPlaying(false);
      elapsedAtPauseRef.current = 0;
    }
  };

  const play = () => {
    const ctx = canvasRef.current.getContext('2d');
    const elapsed = elapsedAtPauseRef.current;
    layoutRef.current = buildLayout(ctx, entries, canvasWidth, fontSize);

    // resuming keeps the schedule, and so the clips already picked for it: otherwise
    // playback would re-pace itself mid-run against different sounds
    if (elapsed === 0 || !scheduleRef.current) {
      const bank = soundBankRef.current;
      const lineCount = entries.filter((e) => e.text.trim()).length;
      const audio = bank
        ? { lines: pickSounds(bank, lineCount), period: bank.period, dissolve: bank.dissolve }
        : {};
      scheduleRef.current = buildSchedule(layoutRef.current, viewportHeight, audio);
      particlePlanRef.current = buildParticlePlan(layoutRef.current);
    }

    // a clip that was mid-way through when we paused picks up at the animation's offset,
    // rather than restarting or being skipped
    const { cues } = scheduleRef.current;
    nextCueRef.current = cues.filter((cue) => cue.time <= elapsed).length;
    const current = cues[nextCueRef.current - 1];
    if (current && elapsed - current.time < current.clip.duration) {
      playClip(current.clip, elapsed - current.time);
    }

    startPerfRef.current = performance.now() - elapsed;
    setIsPlaying(true);
    rafRef.current = requestAnimationFrame(tick);
  };

  const pause = () => {
    cancelAnimationFrame(rafRef.current);
    scheduleRef.current?.cues.forEach(({ clip }) => clip.el.pause());
    elapsedAtPauseRef.current = performance.now() - startPerfRef.current;
    setIsPlaying(false);
  };

  const replay = () => {
    cancelAnimationFrame(rafRef.current);
    silence();
    elapsedAtPauseRef.current = 0;
    scheduleRef.current = null; // fresh run, fresh clips
    play();
  };

  // a hand-edited chain is no longer the ending it was loaded from
  const updateEntry = (id, patch) => {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));
    setLoaded(null);
  };

  const addEntry = () => {
    setEntries((prev) => [...prev, makeEntry('')]);
    setLoaded(null);
  };

  const removeEntry = (id) => {
    setEntries((prev) => prev.filter((e) => e.id !== id));
    setLoaded(null);
  };

  // Lifts a line out of the chain and drops it back in at `to`, which is an insertion point
  // (0..length), not a row index — a line dragged to the bottom lands after the last one.
  const moveEntryTo = (id, to) => {
    setEntries((prev) => {
      const from = prev.findIndex((e) => e.id === id);
      if (from < 0) return prev;
      const next = [...prev];
      const [line] = next.splice(from, 1);
      // the removal shifts everything after it up one, so a later target does too
      next.splice(to > from ? to - 1 : to, 0, line);
      return next;
    });
    setLoaded(null);
  };

  /**
   * Dragging a line, on pointer events rather than HTML5 drag-and-drop: `dragstart` never
   * fires from a touch, so the grip was dead on a phone. Pointer capture keeps the moves
   * coming to the grip even when the finger leaves it, which it always does.
   *
   * The insertion point is found by measuring the rows: whichever row the pointer is over,
   * above its midpoint means before it, below means after.
   */
  const startDrag = (e, id) => {
    e.preventDefault(); // a touch here scrolls the page otherwise
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // capture is an optimisation, not a requirement: the window listeners below do the work
    }
    setDragId(id);
    setDropAt(entries.findIndex((entry) => entry.id === id));

    const insertionAt = (clientY) => {
      const rows = [...(listRef.current?.querySelectorAll('.line-item') ?? [])];
      for (let i = 0; i < rows.length; i++) {
        const box = rows[i].getBoundingClientRect();
        if (clientY < box.top + box.height / 2) return i;
      }
      return rows.length; // past the last row: it goes on the end
    };

    const onMove = (move) => setDropAt(insertionAt(move.clientY));

    const onUp = (up) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('pointerup', onUp);
      moveEntryTo(id, insertionAt(up.clientY));
      setDragId(null);
      setDropAt(null);
    };

    const onCancel = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      setDragId(null);
      setDropAt(null);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
  };

  // the grip is a button, so the keyboard can reorder too — dragging is not the only way in
  const nudgeEntry = (id, delta) => {
    const i = entries.findIndex((e) => e.id === id);
    if (i < 0 || i + delta < 0 || i + delta >= entries.length) return;
    moveEntryTo(id, delta < 0 ? i - 1 : i + 2);
  };

  // picking doesn't drop you into the editor; the ending plays first. One of the player's
  // own endings brings its colours with it, since they're part of what they made.
  const loadEnding = (ending) => {
    setEntries(ending.entries.map((e) => makeEntry(e.text, e.red)));
    if (ending.colors) {
      setTextColor(ending.colors.textColor);
      setRedColor(ending.colors.redColor);
    }
    setLoaded(ending);
    // which of the player's own endings this chain *is*, which is what makes saving an
    // update rather than a copy. Unlike `loaded` it survives editing — editing is the whole
    // reason it's there.
    setSource(ending.custom ? ending : null);
    setStage('playing');
  };

  const flashSaved = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
  };

  const flashNotice = (message) => {
    setNotice(message);
    setTimeout(() => setNotice(null), 2600);
  };

  /**
   * A write to the deck, which can fail: localStorage may be full, or missing entirely
   * (Safari's private mode). A failure must not leave the editor claiming the ending is
   * saved when it isn't, so nothing about the deck is put into state unless the write
   * actually landed — the ending stays unsaved, visibly, and the reason is said.
   */
  const writeDeck = (write) => {
    try {
      const list = write();
      setCustom(list);
      return list;
    } catch (err) {
      flashNotice(err.message);
      return null;
    }
  };

  // Saves the chain as one of the player's own. It's kept apart from the game's hundred
  // (customEndings.js): it never counts as watched and can't complete the set.
  const saveEnding = () => {
    const list = writeDeck(() => saveCustom({ entries, textColor, redColor }));
    if (!list) return;
    setSource(list[list.length - 1] ?? null); // saving again now updates what was just saved
    flashSaved();
  };

  // writes the chain back over the ending it came from, rather than growing a second copy
  const updateEnding = () => {
    if (!source) return;
    const list = writeDeck(() => updateCustom(source.number, { entries, textColor, redColor }));
    if (!list) return;
    setSource(list.find((e) => e.number === source.number) ?? null);
    flashSaved();
  };

  const removeCustom = (ending) => {
    if (!writeDeck(() => deleteCustom(ending.number))) return; // it's still there; say so, keep it
    // the chain in the editor is no longer any saved ending, so saving it makes a new one
    if (source?.number === ending.number) setSource(null);
  };

  const exportEndings = () => {
    const blob = new Blob([exportCustom()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.download = 'blackout-endings.json';
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);
  };

  // imports add to what's already saved; they never replace it (see importCustom). A bad
  // file and a failed write both land here, and both get said.
  const importEndings = async (file) => {
    if (!file) return;
    try {
      const text = await file.text();
      const { list, added } = importCustom(text);
      setCustom(list);
      flashNotice(`${added} added`);
    } catch (err) {
      flashNotice(err.message);
    }
  };

  // An ending counts as watched only once it has played all the way through: skipping out
  // of one doesn't mark it, or the list would colour itself in for endings never seen. The
  // ending that completes the set falls into the true ending instead of the editor.
  const endPlayback = (completed) => {
    // the player's own endings are outside the progress system entirely: watching one marks
    // nothing, and it can never be the hundredth
    if (!completed || !loaded || loaded.custom) {
      setStage('editor');
      return;
    }

    const next = new Set(watched).add(loaded.number);
    saveWatched(next);
    setWatched(next);
    setStage(next.size === ENDINGS.length && !watched.has(loaded.number) ? 'trueend' : 'editor');
  };

  // asked in the game's dialogue box rather than window.confirm (Confirm.jsx)
  const forgetProgress = () => {
    const empty = new Set();
    saveWatched(empty);
    setWatched(empty);
    setAsking(false);
  };

  const download = () => {
    const link = document.createElement('a');
    link.download = 'blackout-ending.png';
    link.href = canvasRef.current.toDataURL('image/png');
    link.click();
  };

  const downloadVideo = async () => {
    cancelAnimationFrame(rafRef.current);
    silence();
    setIsPlaying(false);
    setExportProgress(0);

    try {
      const bank = soundBankRef.current;
      const lineCount = entries.filter((e) => e.text.trim()).length;
      const { blob, extension, videoCodec, audioCodec } = await exportVideo({
        entries,
        fontSize,
        canvasWidth,
        colors,
        bank,
        sounds: bank ? pickSounds(bank, lineCount) : [],
        onProgress: setExportProgress,
      });

      // the codec depends on what the browser can encode, so report what came out
      console.info(`Exported ${extension}: video ${videoCodec}, audio ${audioCodec ?? 'none (silent)'}`);

      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.download = `blackout-ending.${extension}`;
      link.href = url;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      alert(`Video export failed: ${err.message}`);
    } finally {
      setExportProgress(null);
    }
  };

  return (
    // the theme's accents are CSS vars, so every framed thing picks them up
    <div style={theme.vars}>
      <div className="backdrop" style={{ background: theme.backdrop }} />

      {stage === 'picker' && (
        <EndingPicker
          onPick={loadEnding}
          onClose={() => setStage('editor')}
          onDelete={removeCustom}
          cursor={bank?.cursor}
          watched={watched}
          custom={custom}
        />
      )}

      {stage === 'playing' && (
        <EndingPlayback
          entries={entries}
          colors={colors}
          fontSize={fontSize}
          canvasWidth={canvasWidth}
          bank={bank}
          ready={fontReady}
          onDone={endPlayback}
        />
      )}

      {stage === 'trueend' && <TrueEnding onDone={() => setStage('editor')} />}

      {asking && (
        <Confirm
          question="KILL THE PAST?"
          onConfirm={forgetProgress}
          onCancel={() => setAsking(false)}
          cursor={bank?.cursor}
        />
      )}

      {editing && (
        <nav className="crumbs">
          {theme.crumbs.map((crumb) => (
            <span key={crumb}>{crumb}</span>
          ))}
          <button type="button" className="chapter" onClick={cycleTheme} title="Next chapter">
            {theme.name}
          </button>
        </nav>
      )}

      <div className="app" hidden={!editing}>
        <div id="controls" className="panel">
          <h1>
            {theme.name}
            <i className="cursor" />
          </h1>
          <span className="legend">Load an ending</span>
          <button type="button" id="endingPicker" onClick={() => setStage('picker')}>
            {loaded ? `${loaded.number} — ${loaded.label}` : 'Select Text…'}
          </button>

          <span className="legend">Choice / result lines</span>
          {/* Drag a line by its grip to reorder. The rule shows where it will land. */}
          <div id="lineList" ref={listRef}>
            {entries.map((entry, i) => (
              <div
                className={`line-item ${dragId === entry.id ? 'dragging' : ''} ${
                  dropAt === i ? 'drop-before' : ''
                } ${dropAt === entries.length && i === entries.length - 1 ? 'drop-after' : ''}`}
                key={entry.id}
              >
                <button
                  type="button"
                  className="line-grip"
                  aria-label={`Reorder line ${i + 1}: drag, or use the arrow keys`}
                  title="Drag to reorder"
                  // Pointer events, not HTML5 drag-and-drop: dragstart never fires from a
                  // touch, so the grip would do nothing at all on a phone. This is one path
                  // for mouse, touch and pen.
                  onPointerDown={(e) => startDrag(e, entry.id)}
                  onKeyDown={(e) => {
                    const delta = { ArrowUp: -1, ArrowDown: 1 }[e.key];
                    if (!delta) return;
                    e.preventDefault();
                    nudgeEntry(entry.id, delta);
                  }}
                >
                  ⠿
                </button>
                <input
                  type="text"
                  value={entry.text}
                  onChange={(e) => updateEntry(entry.id, { text: e.target.value })}
                  placeholder="Line text"
                />
                <button
                  type="button"
                  className={`toggle-btn ${entry.red ? 'active' : ''}`}
                  onClick={() => updateEntry(entry.id, { red: !entry.red })}
                >
                  {/* the two colours are the user's to pick, so the toggle names the role */}
                  {entry.red ? 'final' : 'text'}
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => removeEntry(entry.id)}
                  aria-label="Remove line"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <button type="button" className="add-line" onClick={addEntry}>
            + Add line
          </button>

          <span className="legend">Type</span>
          <div className="row">
            <div>
              <label className="field-label" htmlFor="fontSize">
                Font size
              </label>
              <input
                id="fontSize"
                type="number"
                min={12}
                max={72}
                value={fontSize}
                onChange={(e) => setFontSize(Number(e.target.value) || 32)}
              />
            </div>
            <div>
              <label className="field-label" htmlFor="canvasWidth">
                Resolution
              </label>
              <select
                id="canvasWidth"
                value={canvasWidth}
                onChange={(e) => setCanvasWidth(Number(e.target.value))}
              >
                {[800, 1024, 1280].map((width) => (
                  <option key={width} value={width}>
                    {width} × {viewportHeightFor(width)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <span className="legend">Colors</span>
          <div className="row">
            <div>
              <label className="field-label" htmlFor="textColor">
                Text
              </label>
              <input
                id="textColor"
                type="color"
                value={textColor}
                onChange={(e) => setTextColor(e.target.value)}
              />
            </div>
            <div>
              <label className="field-label" htmlFor="redColor">
                Final line
              </label>
              <input
                id="redColor"
                type="color"
                value={redColor}
                onChange={(e) => setRedColor(e.target.value)}
              />
            </div>
          </div>

          <span className="legend">Sound</span>
          {/* the last line's sound, and only the last line's: everything above it keeps the
              game's. It belongs to the session, not to the chain (see audio.js). */}
          <div className="actions">
            <button type="button" disabled={exporting} onClick={() => soundInputRef.current?.click()}>
              {finalSound ? 'Change sound' : 'Final line sound'}
            </button>
            {finalSound && (
              <button type="button" disabled={exporting} onClick={() => setFinalSound(null)}>
                Use the game's
              </button>
            )}
            <input
              ref={soundInputRef}
              type="file"
              accept="audio/*,.mp3"
              hidden
              onChange={(e) => {
                chooseFinalSound(e.target.files?.[0]);
                e.target.value = ''; // so the same file can be picked twice
              }}
            />
          </div>
          <p className="note">{soundError ?? (finalSound ? finalSound.name : 'Accepts .mp3 files.')}</p>

          <span className="legend">Playback</span>
          <div className="actions">
            <button
              type="button"
              className="primary"
              disabled={!fontReady || exporting}
              onClick={isPlaying ? pause : play}
            >
              {isPlaying ? 'Pause' : 'Play'}
            </button>
            <button type="button" className="primary" disabled={!fontReady || exporting} onClick={replay}>
              Replay
            </button>
          </div>

          <span className="legend">Export</span>
          <div className="actions">
            <button type="button" disabled={exporting} onClick={download}>
              PNG
            </button>
            <button type="button" disabled={!fontReady || exporting || !videoSupported} onClick={downloadVideo}>
              {exporting ? `Video ${Math.round(exportProgress * 100)}%` : 'Video'}
            </button>
          </div>
          {!videoSupported && <p className="note">Video export needs a browser with WebCodecs.</p>}

          <span className="legend">Your endings</span>
          {/* a chain loaded from your own deck saves back over itself; anything else is new */}
          <div className="actions">
            {source && (
              <button type="button" disabled={!hasLines} onClick={updateEnding}>
                {saved ? 'Saved' : `Update ${source.number}`}
              </button>
            )}
            <button type="button" disabled={!hasLines} onClick={saveEnding}>
              {saved && !source ? 'Saved' : source ? 'Save as new' : 'Save this chain'}
            </button>
          </div>
          <div className="actions">
            <button type="button" disabled={!custom.length} onClick={exportEndings}>
              Export
            </button>
            <button type="button" onClick={() => importRef.current?.click()}>
              Import
            </button>
            {/* the file input is the only way to read a file, but it needn't be seen */}
            <input
              ref={importRef}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => {
                importEndings(e.target.files?.[0]);
                e.target.value = ''; // so the same file can be picked twice
              }}
            />
          </div>
          {/* what the deck just did, or why it couldn't; nothing at rest */}
          {notice && <p className="note">{notice}</p>}

          <span className="legend">Progress</span>
          <p className="tally">
            <b>{String(watched.size).padStart(3, '0')}</b> / {ENDINGS.length} endings watched
          </p>
          {/* watching the hundredth ending falls into the true ending on its own; this
              is only here to watch it again (and to work on it) */}
          <div className="actions">
            <button type="button" onClick={() => setStage('trueend')}>
              True ending
            </button>
            <button type="button" className="danger" disabled={!watched.size} onClick={() => setAsking(true)}>
              Delete save data
            </button>
          </div>
        </div>

        <div id="preview-wrap" className="panel">
          <canvas ref={canvasRef} width={canvasWidth} height={320} />
        </div>
      </div>
    </div>
  );
}
