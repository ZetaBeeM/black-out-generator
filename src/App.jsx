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
  const [fontSize, setFontSize] = useState(26);
  const [canvasWidth, setCanvasWidth] = useState(1024);
  const [textColor, setTextColor] = useState('#cccccc');
  const [redColor, setRedColor] = useState('#a01a20');
  const [isPlaying, setIsPlaying] = useState(false);
  const [fontReady, setFontReady] = useState(false);
  const [exportProgress, setExportProgress] = useState(null); 
  const [themeIndex, setThemeIndex] = useState(DEFAULT_THEME);
  const [stage, setStage] = useState('picker'); 
  const [watched, setWatched] = useState(loadWatched);
  const [custom, setCustom] = useState(loadCustom); 
  const [loaded, setLoaded] = useState(null); 
  const [asking, setAsking] = useState(false); 
  const [saved, setSaved] = useState(false); 
  const [source, setSource] = useState(null); 
  const [notice, setNotice] = useState(null); 
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
  const [soundBank, setSoundBank] = useState(null); 
  const [finalSound, setFinalSound] = useState(null); 
  const [soundError, setSoundError] = useState(null); 
  const nextCueRef = useRef(0);
  const importRef = useRef(null); 
  const soundInputRef = useRef(null); 

  const colors = useMemo(() => ({ textColor, redColor }), [textColor, redColor]);
  const hasLines = entries.some((e) => e.text.trim()); 
  const exporting = exportProgress !== null;
  const videoSupported = canExportVideo();
  const viewportHeight = viewportHeightFor(canvasWidth);
  const theme = THEMES[themeIndex];
  const cycleTheme = () => setThemeIndex((i) => (i + 1) % THEMES.length);
  const editing = stage === 'editor';

  useEffect(() => {
    document.fonts.load('32px DotGothic16').then(() => setFontReady(true));
  }, []);

  useEffect(() => {
    let live = true;
    loadSoundBank().then((loaded) => live && setSoundBank(loaded));
    return () => {
      live = false;
    };
  }, []);

  const bank = useMemo(
    () => (soundBank && finalSound ? { ...soundBank, final: [finalSound] } : soundBank),
    [soundBank, finalSound],
  );
  useEffect(() => {
    soundBankRef.current = bank;
  }, [bank]);
  
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
    
    if (elapsed === 0 || !scheduleRef.current) {
      const bank = soundBankRef.current;
      const lineCount = entries.filter((e) => e.text.trim()).length;
      const audio = bank
        ? { lines: pickSounds(bank, lineCount), period: bank.period, dissolve: bank.dissolve }
        : {};
      scheduleRef.current = buildSchedule(layoutRef.current, viewportHeight, audio);
      particlePlanRef.current = buildParticlePlan(layoutRef.current);
    }
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
    scheduleRef.current = null; 
    play();
  };
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
  
  const moveEntryTo = (id, to) => {
    setEntries((prev) => {
      const from = prev.findIndex((e) => e.id === id);
      if (from < 0) return prev;
      const next = [...prev];
      const [line] = next.splice(from, 1);
      next.splice(to > from ? to - 1 : to, 0, line);
      return next;
    });
    setLoaded(null);
  };
  const startDrag = (e, id) => {
    e.preventDefault(); 
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      
    }
    setDragId(id);
    setDropAt(entries.findIndex((entry) => entry.id === id));
    const insertionAt = (clientY) => {
      const rows = [...(listRef.current?.querySelectorAll('.line-item') ?? [])];
      for (let i = 0; i < rows.length; i++) {
        const box = rows[i].getBoundingClientRect();
        if (clientY < box.top + box.height / 2) return i;
      }
      return rows.length; 
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
  
  const nudgeEntry = (id, delta) => {
    const i = entries.findIndex((e) => e.id === id);
    if (i < 0 || i + delta < 0 || i + delta >= entries.length) return;
    moveEntryTo(id, delta < 0 ? i - 1 : i + 2);
  };
  
  const loadEnding = (ending) => {
    setEntries(ending.entries.map((e) => makeEntry(e.text, e.red)));
    if (ending.colors) {
      setTextColor(ending.colors.textColor);
      setRedColor(ending.colors.redColor);
    }
    setLoaded(ending);
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
  
  const saveEnding = () => {
    const list = writeDeck(() => saveCustom({ entries, textColor, redColor }));
    if (!list) return;
    setSource(list[list.length - 1] ?? null); 
    flashSaved();
  };
  const updateEnding = () => {
    if (!source) return;
    const list = writeDeck(() => updateCustom(source.number, { entries, textColor, redColor }));
    if (!list) return;
    setSource(list.find((e) => e.number === source.number) ?? null);
    flashSaved();
  };
  const removeCustom = (ending) => {
    if (!writeDeck(() => deleteCustom(ending.number))) return; 
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
  const endPlayback = (completed) => {
    
    if (!completed || !loaded || loaded.custom) {
      setStage('editor');
      return;
    }
    const next = new Set(watched).add(loaded.number);
    saveWatched(next);
    setWatched(next);
    setStage(next.size === ENDINGS.length && !watched.has(loaded.number) ? 'trueend' : 'editor');
  };
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
          {}
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
                  {}
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
          {}
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
                e.target.value = ''; 
              }}
            />
          </div>
          {}
          {notice && <p className="note">{notice}</p>}
          <span className="legend">Progress</span>
          <p className="tally">
            <b>{String(watched.size).padStart(3, '0')}</b> / {ENDINGS.length} endings watched
          </p>
          {}
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