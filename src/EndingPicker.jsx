import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { playClip } from './audio.js';
import Confirm from './Confirm.jsx';
import ENDINGS from './endings.json';

const FRAME = { left: 14.3, width: 71.4, top: 9.8, height: 76.2 }; 
const PANEL = { left: 2.1, width: 95.8, top: 12.3, height: 80 }; 
const PANEL_HALF = (FRAME.height * PANEL.height) / 100 / 2; 
const ROW_H = 6.3; 
const K = Math.PI / (2 * PANEL_HALF); 
const gudermannian = (x) => 2 * Math.atan(Math.tanh(x / 2));
const project = (s) => ({ y: gudermannian(K * s) / K, squash: 1 / Math.cosh(K * s) });
const MIN_SQUASH = 0.06; 
const RIM_U = gudermannian(Math.acosh(1 / MIN_SQUASH)) / K;

const ROLL_RATE = 0.018; 
const SPAN_U = Math.acosh(1 / MIN_SQUASH) / K; 
const VISIBLE_ROWS = Math.ceil((2 * SPAN_U) / ROW_H) + 2;
const copiesFor = (length) => (length > 0 ? Math.ceil(VISIBLE_ROWS / length) : 1);

const offsetOf = (i, roll, count) => {
  const d = ((((i - roll) % count) + count * 1.5) % count) - count / 2;
  return d * ROW_H;
};

const OPEN_MS = 1250;
const EXIT_MS = 450;
const DEAD_AIR_MS = 2000; 
const TYPE_MS = 900; 
const SWIPE_PX = 40; 
const NOISE_MS = 1000 / 14; 
const JITTER_U = 0.16; 
const jitter = (i, seed, axis) => {
  const x = Math.sin((i + 1) * 12.9898 + seed * 78.233 + axis * 43.758) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1; 
};
const TITLES = { endings: 'Select Text', custom: 'Your Text' };
const FLOAT_MS = [2500, 3300]; 
const floatPeriodOf = (i) => Math.round(FLOAT_MS[0] + ((jitter(i, 7.13, 0) + 1) / 2) * (FLOAT_MS[1] - FLOAT_MS[0]));
const floatDelayOf = (i) => -Math.round(((jitter(i, 3.71, 1) + 1) / 2) * floatPeriodOf(i));
export default function EndingPicker({ onPick, onClose, onDelete, cursor, watched, custom }) {
  const [deck, setDeck] = useState('endings'); 
  const onCustom = deck === 'custom';
  const deckRows = onCustom ? custom : ENDINGS;
  const empty = onCustom && custom.length === 0;
  
  
  const copies = copiesFor(deckRows.length);
  const rows = empty ? [] : Array.from({ length: deckRows.length * copies }, (_, i) => deckRows[i % deckRows.length]);
  const count = Math.max(1, rows.length);
  const title = TITLES[deck];
  const [selected, setSelected] = useState(0);
  const [opened, setOpened] = useState(false);
  const [exiting, setExiting] = useState(false); 
  const [typing, setTyping] = useState(null); 
  const [pendingDelete, setPendingDelete] = useState(null); 
  const typeTimerRef = useRef(0);
  const rowRefs = useRef([]);
  const labelRefs = useRef([]);
  const ruleRefs = useRef([]);
  const noiseRef = useRef(null);
  const frameRef = useRef(null);
  const clearRef = useRef(null);
  const jitterRef = useRef({ at: 0, seed: 0 });
  const exitAtRef = useRef(0); 
  const rollRef = useRef(0); 
  const selectedRef = useRef(0);
  const typedRef = useRef({ text: '', at: 0 });
  selectedRef.current = selected;
  const moveTo = (i) => {
    if (cursor?.move) playClip(cursor.move);
    selectedRef.current = i; 
    setSelected(i);
  };
  const move = (delta) => moveTo((((selectedRef.current + delta) % count) + count) % count);
  const switchDeck = () => {
    if (cursor?.move) playClip(cursor.move);
    rollRef.current = 0;
    selectedRef.current = 0;
    setSelected(0);
    setTyping(null);
    setDeck((d) => (d === 'endings' ? 'custom' : 'endings'));
  };
  const click = (i) => {
    if (empty) return;
    if (i === selectedRef.current) pick(rows[i]);
    else moveTo(i);
  };
  const pick = (ending) => {
    if (exitAtRef.current) return;
    if (cursor?.select) playClip(cursor.select);
    exitAtRef.current = performance.now(); 
    setExiting(true); 
    setTimeout(() => onPick(ending), EXIT_MS + DEAD_AIR_MS);
  };
  useEffect(() => {
    const t = setTimeout(() => setOpened(true), OPEN_MS);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    const onKey = (e) => {
      
      if (!opened || exitAtRef.current || pendingDelete) return;
      const keys = { ArrowUp: -1, ArrowDown: 1, PageUp: -7, PageDown: 7 };
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        switchDeck();
      } else if (empty) {
        if (e.key !== 'Escape') return;
        onClose();
      } else if (keys[e.key]) {
        move(keys[e.key]);
      } else if (e.key === 'Home') {
        moveTo(0);
      } else if (e.key === 'End') {
        moveTo(deckRows.length - 1); 
      } else if (e.key === 'Enter') {
        pick(rows[selectedRef.current]);
      } else if (e.key === 'Escape') {
        onClose();
      } else if (onCustom && (e.key === 'Delete' || e.key === 'Backspace')) {
        setPendingDelete(rows[selectedRef.current]);
      } else if (e.key.length === 1) {
        const now = performance.now();
        const typed = (now - typedRef.current.at < TYPE_MS ? typedRef.current.text : '') + e.key.toLowerCase();
        typedRef.current = { text: typed, at: now };
        const hit = rows.findIndex((e2) => e2.label.toLowerCase().startsWith(typed));
        if (hit >= 0 && hit !== selectedRef.current) moveTo(hit);
        
        setTyping({ text: typed, hit: hit >= 0 });
        clearTimeout(typeTimerRef.current);
        typeTimerRef.current = setTimeout(() => setTyping(null), TYPE_MS);
      } else {
        return;
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      clearTimeout(typeTimerRef.current);
    };
  }, [onPick, onClose, onDelete, cursor, opened, deck, rows, count, empty, pendingDelete]);
  useLayoutEffect(() => {
    let raf = 0;
    let last = performance.now();
    const frame = (now) => {
      const dt = Math.min(64, now - last);
      last = now;
      const roll = rollRef.current;
      const delta = ((((selectedRef.current - roll) % count) + count * 1.5) % count) - count / 2;
      rollRef.current = Math.abs(delta) < 0.001 ? roll + delta : roll + delta * (1 - Math.exp(-ROLL_RATE * dt));
      
      const gone = exitAtRef.current ? Math.min(1, (now - exitAtRef.current) / EXIT_MS) : 0;
      const slip = () => (gone ? (Math.random() - 0.5) * 26 * (1 - gone) : 0);
      const rowFade = Math.max(0, 1 - gone * 3);
      const ruleFade = Math.max(0, 1 - gone ** 3);
      if (now - jitterRef.current.at >= NOISE_MS) {
        jitterRef.current = { at: now, seed: Math.random() };
      }
      const cursor = project(offsetOf(selectedRef.current, rollRef.current, count));
      if (clearRef.current) {
        clearRef.current.style.transform = `translate(0, calc(${cursor.y.toFixed(2)} * var(--u))) scaleY(${cursor.squash.toFixed(3)})`;
        clearRef.current.style.opacity = gone ? '0' : '1';
      }
      rows.forEach((_, i) => {
        const row = rowRefs.current[i];
        const { y, squash } = project(offsetOf(i, rollRef.current, count));
        const shiver = i === selectedRef.current ? 0 : 1;
        if (row) {
          const jx = shiver * jitter(i, jitterRef.current.seed, 0) * JITTER_U;
          const jy = shiver * jitter(i, jitterRef.current.seed, 1) * JITTER_U * 0.5;
          row.style.display = squash > MIN_SQUASH ? '' : 'none';
          row.style.transform = `translate(calc(${(slip() + jx).toFixed(3)} * var(--u)), calc(${(y + jy).toFixed(3)} * var(--u))) scaleY(${squash.toFixed(3)})`;
          const grain = 1 - shiver * 0.22 * Math.abs(jitter(i, jitterRef.current.seed, 2));
          row.style.opacity = ((0.28 + 0.72 * squash) * rowFade * grain).toFixed(3);
        }
        const rule = ruleRefs.current[i];
        const edge = project(offsetOf(i + 0.5, rollRef.current, count));
        if (rule) {
          rule.style.display = edge.squash > MIN_SQUASH ? '' : 'none';
          rule.style.transform = `translate(calc(${slip().toFixed(2)} * var(--u)), calc(${edge.y.toFixed(2)} * var(--u)))`;
          rule.style.opacity = ((gone ? 0.5 + 0.5 * edge.squash : 0.2 + 0.6 * edge.squash) * ruleFade).toFixed(3);
        }
      });
      if (frameRef.current) {
        frameRef.current.style.opacity = gone ? Math.max(0, 1 - gone ** 2 * 1.6).toFixed(3) : '';
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
    
  }, [rows, count]);
  useEffect(() => {
    let live = true;
    const measure = () => {
      if (!live) return;
      rowRefs.current.forEach((row) => row && (row.style.display = ''));
      labelRefs.current.forEach((label) => {
        const row = label?.parentElement;
        if (!row || !row.clientWidth) return;
        const pad = parseFloat(getComputedStyle(row).paddingLeft) || 0;
        const overrun = label.scrollWidth - (row.clientWidth - pad * 2);
        if (overrun <= 1) {
          label.classList.remove('scrolls');
          return;
        }
        
        const travel = (overrun / (row.clientHeight * 2)) * 1000; 
        label.style.setProperty('--shift', `${overrun}px`);
        label.style.setProperty('--scroll-ms', `${Math.max(3200, travel / 0.38)}ms`);
        label.classList.add('scrolls');
      });
    };
    document.fonts.ready.then(measure);
    window.addEventListener('resize', measure);
    return () => {
      live = false;
      window.removeEventListener('resize', measure);
    };
  }, [rows]);
  
  useEffect(() => {
    const canvas = noiseRef.current;
    const ctx = canvas.getContext('2d');
    let raf = 0;
    let last = 0;

    const frame = (now) => {
      raf = requestAnimationFrame(frame);
      const gone = exitAtRef.current ? Math.min(1, (now - exitAtRef.current) / EXIT_MS) : 0;
      if (!gone && now - last < NOISE_MS) return; 
      last = now;

      const blowout = gone ? Math.max(0, 1 - gone * 1.4) : 0;
      const gain = 1 + 2.6 * blowout;
      const fade = gone ? Math.max(0, 1 - gone ** 1.5) : 1;

      const { width, height } = canvas;
      const image = ctx.createImageData(width, height);
      const { data } = image;
      for (let y = 0; y < height; y++) {
        const line = Math.random() * 34;
        
        const tear = gone && Math.random() < 0.06 * (1 - gone) ? 255 : 0;
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4;
          const v = Math.min(255, ((8 + line + Math.random() * 62) * gain + tear) * fade);
          data[i] = v;
          data[i + 1] = v;
          data[i + 2] = v;
          data[i + 3] = 255;
        }
      }
      ctx.putImageData(image, 0, 0);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  const onWheel = (e) => move(Math.sign(e.deltaY));
  const touchRef = useRef(null); 
  const onTouchStart = (e) => {
    const touch = e.touches[0];
    touchRef.current = { x: touch.clientX, y: touch.clientY, rowY: touch.clientY, switched: false };
  };
  const onTouchMove = (e) => {
    const start = touchRef.current;
    if (!start || exitAtRef.current || pendingDelete) return;
    const touch = e.touches[0];
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dx) > Math.abs(dy)) {
      if (!start.switched && Math.abs(dx) > SWIPE_PX) {
        start.switched = true;
        switchDeck();
      }
      return;
    }
    if (start.switched || empty) return;
    const rowHeight = e.currentTarget.clientHeight * (ROW_H / 100) * (100 / (2 * PANEL_HALF)) || 40;
    const steps = Math.trunc((start.rowY - touch.clientY) / Math.max(24, rowHeight));
    if (steps !== 0) {
      move(steps > 0 ? 1 : -1);
      start.rowY -= Math.sign(steps) * Math.max(24, rowHeight);
    }
  };

  const onTouchEnd = () => {
    touchRef.current = null;
  };
  return (
    <div
      className={`picker ${opened ? '' : 'powering-up'} ${exiting ? 'exiting' : ''}`}
      onMouseDown={(e) => e.target === e.currentTarget && opened && onClose()}
    >
      <div className="picker-stage">
        <div className="picker-frame" ref={frameRef}>
          <h2 className="picker-title" aria-label={title}>
            {}
            {[...title].map((ch, i) => (
              <span
                key={`${deck}-${i}`}
                className="picker-title-letter"
                aria-hidden
                style={{ '--float-ms': `${floatPeriodOf(i)}ms`, '--float-delay': `${floatDelayOf(i)}ms` }}
              >
                {ch === ' ' ? ' ' : ch}
              </span>
            ))}
          </h2>
          <div
            className="picker-list"
            onWheel={onWheel}
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
            style={{ '--rim': RIM_U.toFixed(2) }}
          >
            <canvas className="picker-noise" ref={noiseRef} width={320} height={160} />
            {!empty && <div className="picker-clear" ref={clearRef} aria-hidden />}
            {}
            {empty && <p className="picker-empty">No endings of your own yet — write one and save it</p>}
            {}
            {!empty &&
              rows.map((ending, i) => (
                <div
                  key={`${ending.number}-${i}`}
                  ref={(el) => (ruleRefs.current[i] = el)}
                  className="picker-rule"
                  aria-hidden
                />
              ))}
            {!empty &&
              rows.map((ending, i) => (
                <button
                  type="button"
                  key={`${ending.number}-${i}`}
                  ref={(el) => (rowRefs.current[i] = el)}
                  className={`picker-row ${i === selected ? 'chosen' : ''} ${
                    !onCustom && watched?.has(ending.number) ? 'seen' : ''
                  }`}
                  onClick={() => click(i)}
                >
                  <span className="picker-label" ref={(el) => (labelRefs.current[i] = el)}>
                    {ending.label}
                  </span>
                </button>
              ))}
          </div>
        </div>
        {}
        <div className="picker-hint">
          {typing ? (
            <span className={`picker-typed ${typing.hit ? '' : 'miss'}`}>
              {typing.text}
              <i className="cursor" />
              {!typing.hit && <em>no match</em>}
            </span>
          ) : (
            <>
              <span>↑↓ move</span>
              <span>←→ {onCustom ? 'endings' : 'yours'}</span>
              {!empty && <span>ENTER load</span>}
              {onCustom && !empty && <span>DEL remove</span>}
              <span>ESC cancel</span>
            </>
          )}
          <span className="picker-count">
            {}
            {empty
              ? '000 / 000'
              : `${String((selected % deckRows.length) + 1).padStart(3, '0')} / ${String(deckRows.length).padStart(3, '0')}`}
            {!onCustom && ` · watched ${watched?.size ?? 0}`}
          </span>
        </div>
      </div>
      {}
      {pendingDelete && (
        <Confirm
          question={`THROW AWAY "${pendingDelete.label}"?`}
          confirmLabel="Delete"
          cancelLabel="Keep"
          onConfirm={() => {
            onDelete?.(pendingDelete);
            setPendingDelete(null);
            rollRef.current = 0;
            selectedRef.current = 0;
            setSelected(0);
          }}
          onCancel={() => setPendingDelete(null)}
          cursor={cursor}
        />
      )}
    </div>
  );
}