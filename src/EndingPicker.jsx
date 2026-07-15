import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { playClip } from './audio.js';
import Confirm from './Confirm.jsx';
import ENDINGS from './endings.json';

/**
 * The game's "Select Text" screen, where the 100 Blackout endings are picked from. Its
 * rows are the labels in endings.json.
 *
 * It carries two decks: the game's endings, and the player's own (customEndings.js). Left
 * and right switch between them, and the switch is the only difference between them — the
 * custom deck is the same cylinder, the same rows, the same everything. What it isn't is
 * part of the game's set: nothing there colours in as watched, and nothing there can
 * complete the hundred.
 *
 * Everything is expressed in u = 1% of the 16:9 stage's height: the frame, the panel, the
 * row pitch and the type sizes are all fractions of the screen, so the whole thing scales
 * with the viewport. Keep it that way; absolute px here don't survive a resize.
 */
const FRAME = { left: 14.3, width: 71.4, top: 9.8, height: 76.2 }; // % of the stage
const PANEL = { left: 2.1, width: 95.8, top: 12.3, height: 80 }; // % of the frame
const PANEL_HALF = (FRAME.height * PANEL.height) / 100 / 2; // 30.5u, half the list's height
const ROW_H = 6.3; // u, the row pitch at the centre, where a row isn't squashed

/**
 * The rows sit on a cylinder seen edge-on. A row's distance from the centre in unrolled
 * coordinates (s, in u) maps to a screen offset through the Gudermannian, and the row is
 * squashed by the cosine of its angle: vertically only, never horizontally, since the same
 * word at two distances from the centre keeps the same width.
 *
 * Row pitch down the screen runs 68, 68, 66, 56, 46, 36, 24 px: full pitch through the
 * middle, then piling up and flattening into the rim. That is this curve.
 */
const K = Math.PI / (2 * PANEL_HALF); // the angle, per u of unrolled offset
const gudermannian = (x) => 2 * Math.atan(Math.tanh(x / 2));
const project = (s) => ({ y: gudermannian(K * s) / K, squash: 1 / Math.cosh(K * s) });

const MIN_SQUASH = 0.06; // below this a row is a sliver against the rim; don't draw it

// The list's side rules, and the static, end on the cylinder's rim: level with the last
// visible ending, not at the panel's own edge, which sits about a u further out. The rim is
// where squash falls to MIN_SQUASH, so invert project for it. Handed to the CSS as --rim,
// so the rules keep meeting the last row if the cylinder is ever retuned.
const RIM_U = gudermannian(Math.acosh(1 / MIN_SQUASH)) / K;

const ROLL_RATE = 0.018; // how fast the cylinder rolls to the row you picked, per ms

// How many rows the panel can show at once. Measured in *unrolled* coordinates, not screen
// ones: a row is drawn while its squash is above MIN_SQUASH, which is |s| < acosh(1/MIN_SQUASH)/K
// — some 68u, far more than the 29u of screen the rim occupies, because the rows pile up as
// they flatten into it. About 21 rows, so the cylinder is never short of one.
//
// A deck with fewer endings than this is repeated around the cylinder until it fills: three
// saved endings are three names coming round again, the way a hundred do, rather than three
// rows adrift in an empty panel. The spare two keep the rim covered mid-roll.
const SPAN_U = Math.acosh(1 / MIN_SQUASH) / K; // unrolled half-span of what's drawable
const VISIBLE_ROWS = Math.ceil((2 * SPAN_U) / ROW_H) + 2;
const copiesFor = (length) => (length > 0 ? Math.ceil(VISIBLE_ROWS / length) : 1);

// The list wraps: the selected row stays on the centreline and the panel is always full,
// rim to rim. This is the shortest signed distance to row i, on a wheel of `count` rows.
const offsetOf = (i, roll, count) => {
  const d = ((((i - roll) % count) + count * 1.5) % count) - count / 2;
  return d * ROW_H;
};

/**
 * The screen powers up and loses signal rather than appearing and disappearing.
 *
 * Up: black for 650ms, the frame snaps on, the title fades up over the next half second,
 * and the list (static and rows together) pops in at 1200ms.
 *
 * Out: the static blows out to white, the rows tear into horizontally slipped slices, the
 * rules outlive them as tearing scanlines, and the screen collapses to black.
 */
const OPEN_MS = 1250;
const EXIT_MS = 450;
const DEAD_AIR_MS = 2000; // dead screen before the ending loads: the set doesn't find a new signal at once

const TYPE_MS = 900; // how long a type-to-find search stays open for the next keystroke
const SWIPE_PX = 40; // sideways travel before a swipe counts as a deck switch

const NOISE_MS = 1000 / 14; // how often the static is redrawn, and so how often the rows shiver
const JITTER_U = 0.16; // u, about a pixel and a half on a 1080p screen

// A cheap hash, so a row's shiver is a pure function of (row, tick): no stored random
// state per row, and every row moves independently.
const jitter = (i, seed, axis) => {
  const x = Math.sin((i + 1) * 12.9898 + seed * 78.233 + axis * 43.758) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1; // -1..1
};

/**
 * The title floats: it drifts vertically, never horizontally, on a 2.5-3.3s cycle, and each
 * letter goes its own way rather than the word moving as a block.
 *
 * Every letter gets the same bob (keyframes in the CSS) at its own period and its own point
 * in the cycle, both hashed from its index rather than stored. The delay is negative so no
 * letter waits to start: they're all mid-cycle on the first frame.
 */
const TITLES = { endings: 'Select Text', custom: 'Your Text' };
const FLOAT_MS = [2500, 3300]; // the range of periods, one drawn per letter
const floatPeriodOf = (i) => Math.round(FLOAT_MS[0] + ((jitter(i, 7.13, 0) + 1) / 2) * (FLOAT_MS[1] - FLOAT_MS[0]));
const floatDelayOf = (i) => -Math.round(((jitter(i, 3.71, 1) + 1) / 2) * floatPeriodOf(i));

export default function EndingPicker({ onPick, onClose, onDelete, cursor, watched, custom }) {
  // Two decks on one cylinder. Left/right switches; the cursor and the wheel are reset with
  // it, so each deck opens at its top rather than wherever the other one was left.
  const [deck, setDeck] = useState('endings'); // 'endings' | 'custom'
  const onCustom = deck === 'custom';
  const deckRows = onCustom ? custom : ENDINGS;
  const empty = onCustom && custom.length === 0;

  // The wheel is the deck, repeated enough times to fill the cylinder: three saved endings
  // become three names coming round again and again, the same way a hundred do. Every index
  // below is an index into the wheel; `% deckRows.length` gets back to the ending it is.
  // The game's hundred already overflow the panel, so they're copied once and nothing about
  // that deck changes.
  const copies = copiesFor(deckRows.length);
  const rows = empty ? [] : Array.from({ length: deckRows.length * copies }, (_, i) => deckRows[i % deckRows.length]);
  const count = Math.max(1, rows.length);

  const title = TITLES[deck];

  const [selected, setSelected] = useState(0);
  const [opened, setOpened] = useState(false);
  const [exiting, setExiting] = useState(false); // an ending has been chosen; the screen is going
  const [typing, setTyping] = useState(null); // { text, hit } while a type-to-find search is open
  const [pendingDelete, setPendingDelete] = useState(null); // the ending the delete box is asking about
  const typeTimerRef = useRef(0);
  const rowRefs = useRef([]);
  const labelRefs = useRef([]);
  const ruleRefs = useRef([]);
  const noiseRef = useRef(null);
  const frameRef = useRef(null);
  const clearRef = useRef(null);
  const jitterRef = useRef({ at: 0, seed: 0 });
  const exitAtRef = useRef(0); // when the screen started losing signal; 0 while it's up
  const rollRef = useRef(0); // the cylinder's actual position, which chases `selected`
  const selectedRef = useRef(0);
  const typedRef = useRef({ text: '', at: 0 });

  selectedRef.current = selected;

  // Every route to moving the cursor (arrows, Home/End, type-to-find, click) comes through
  // here, which is what plays the blip. Note the clip is played here and not inside the
  // setSelected updater: an updater must be pure, and React calls it twice in development.
  const moveTo = (i) => {
    if (cursor?.move) playClip(cursor.move);
    selectedRef.current = i; // eagerly, so two keypresses in one frame don't collapse into one
    setSelected(i);
  };

  const move = (delta) => moveTo((((selectedRef.current + delta) % count) + count) % count);

  // Left and right switch decks, either way round: the two are a loop, not a list, so right
  // off the custom deck comes back to the game's endings. The wheel is reset with the deck.
  const switchDeck = () => {
    if (cursor?.move) playClip(cursor.move);
    rollRef.current = 0;
    selectedRef.current = 0;
    setSelected(0);
    setTyping(null);
    setDeck((d) => (d === 'endings' ? 'custom' : 'endings'));
  };

  // A click rolls the wheel to that row; it doesn't load it. The list is a cursor you move,
  // so it's Enter, or a second click on the row already under the cursor, that loads.
  const click = (i) => {
    if (empty) return;
    if (i === selectedRef.current) pick(rows[i]);
    else moveTo(i);
  };

  // picking doesn't dismiss the screen, it makes it lose signal; the ending loads once it's gone
  const pick = (ending) => {
    if (exitAtRef.current) return;
    if (cursor?.select) playClip(cursor.select);
    exitAtRef.current = performance.now(); // the rAF loop's clock for the signal loss
    setExiting(true); // and the flag the CSS reads, to take the hint box with it
    setTimeout(() => onPick(ending), EXIT_MS + DEAD_AIR_MS);
  };

  useEffect(() => {
    const t = setTimeout(() => setOpened(true), OPEN_MS);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      // the delete box has its own cursor and its own keys; the list is frozen behind it
      if (!opened || exitAtRef.current || pendingDelete) return;
      const keys = { ArrowUp: -1, ArrowDown: 1, PageUp: -7, PageDown: 7 };
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        switchDeck();
      } else if (empty) {
        // nothing to move the cursor over, and nothing to load, but you can still leave
        if (e.key !== 'Escape') return;
        onClose();
      } else if (keys[e.key]) {
        move(keys[e.key]);
      } else if (e.key === 'Home') {
        moveTo(0);
      } else if (e.key === 'End') {
        moveTo(deckRows.length - 1); // the deck's last ending, not the wheel's last copy of it
        // Enter alone confirms. Space belongs to type-to-find: half these names contain
        // one, and confirming mid-search would load the wrong ending.
      } else if (e.key === 'Enter') {
        pick(rows[selectedRef.current]);
      } else if (e.key === 'Escape') {
        onClose();
      } else if (onCustom && (e.key === 'Delete' || e.key === 'Backspace')) {
        // an ending you wrote, you can throw away — but it's your own writing, and there's no
        // undo, so it's asked for in the game's dialogue box rather than done on the keypress
        setPendingDelete(rows[selectedRef.current]);
      } else if (e.key.length === 1) {
        // type-to-find, so a list of 100 doesn't have to be walked one row at a time
        const now = performance.now();
        const typed = (now - typedRef.current.at < TYPE_MS ? typedRef.current.text : '') + e.key.toLowerCase();
        typedRef.current = { text: typed, at: now };
        const hit = rows.findIndex((e2) => e2.label.toLowerCase().startsWith(typed));
        if (hit >= 0 && hit !== selectedRef.current) moveTo(hit);

        // and it's shown while you type it: the search is invisible otherwise, and nobody
        // finds a feature they can't see. It clears itself when the search window lapses.
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
    // the handler closes over the deck, so it's rebound when the deck changes
  }, [onPick, onClose, onDelete, cursor, opened, deck, rows, count, empty, pendingDelete]);

  // The rows are positioned by writing transforms onto the DOM nodes, not through React:
  // the wheel rolls every frame, and re-rendering 100 rows to move each by two numbers is
  // a lot of work for nothing.
  useLayoutEffect(() => {
    let raf = 0;
    let last = performance.now();

    const frame = (now) => {
      const dt = Math.min(64, now - last);
      last = now;

      // the wheel rolls the short way round to the row that was picked
      const roll = rollRef.current;
      const delta = ((((selectedRef.current - roll) % count) + count * 1.5) % count) - count / 2;
      rollRef.current = Math.abs(delta) < 0.001 ? roll + delta : roll + delta * (1 - Math.exp(-ROLL_RATE * dt));

      // 0 while the screen is up, then 0 to 1 as it loses signal
      const gone = exitAtRef.current ? Math.min(1, (now - exitAtRef.current) / EXIT_MS) : 0;
      // rows slip sideways and are gone a third of the way through; the rules outlive them,
      // tearing across the screen as the last thing to go
      const slip = () => (gone ? (Math.random() - 0.5) * 26 * (1 - gone) : 0);
      const rowFade = Math.max(0, 1 - gone * 3);
      const ruleFade = Math.max(0, 1 - gone ** 3);

      // Every row but the one under the cursor sits in the static, so it shivers with it.
      // The jitter is re-rolled on the static's own tick rather than per frame, so the text
      // and the grain behind it move as one thing instead of two.
      if (now - jitterRef.current.at >= NOISE_MS) {
        jitterRef.current = { at: now, seed: Math.random() };
      }

      // The cursor's row is the one place the static doesn't reach: the noise is flat there.
      // A clean band rides the cylinder under it, masking the noise out (.picker-clear, which
      // also carries the gold blink).
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
          // and it dims and brightens with the static's grain
          const grain = 1 - shiver * 0.22 * Math.abs(jitter(i, jitterRef.current.seed, 2));
          row.style.opacity = ((0.28 + 0.72 * squash) * rowFade * grain).toFixed(3);
        }

        // the rule under a row sits on the boundary between it and the next one,
        // so it rides the same cylinder half a row further down
        const rule = ruleRefs.current[i];
        const edge = project(offsetOf(i + 0.5, rollRef.current, count));
        if (rule) {
          rule.style.display = edge.squash > MIN_SQUASH ? '' : 'none';
          rule.style.transform = `translate(calc(${slip().toFixed(2)} * var(--u)), calc(${edge.y.toFixed(2)} * var(--u)))`;
          rule.style.opacity = ((gone ? 0.5 + 0.5 * edge.squash : 0.2 + 0.6 * edge.squash) * ruleFade).toFixed(3);
        }
      });

      // the frame itself breaks up last
      if (frameRef.current) {
        frameRef.current.style.opacity = gone ? Math.max(0, 1 - gone ** 2 * 1.6).toFixed(3) : '';
      }

      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
    // the loop closes over the deck, so rebuild it when the deck (or its length) changes
  }, [rows, count]);

  // Three of the 100 names are wider than the list (one is 94 characters). Those rows
  // scroll their name out and back at a constant reading speed, dwelling at each end, so a
  // name twice as long simply takes twice as long. A name that fits never gets the class.
  //
  // The overrun is measured, so this waits on document.fonts.ready (measuring against a
  // fallback font gives nonsense) and re-measures on resize, since every length is a
  // fraction of the stage's height.
  useEffect(() => {
    let live = true;

    const measure = () => {
      if (!live) return;

      // Most rows are display: none at any moment, being round the back of the cylinder,
      // and a hidden row measures as zero. Force them all visible for the pass; the rAF
      // loop restores each one's display on the next frame. Skipping this showed 79 of 100
      // names overflowing by exactly the padding width.
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

        // the keyframes spend 76% of the cycle moving and the rest dwelling at the ends
        const travel = (overrun / (row.clientHeight * 2)) * 1000; // two row-heights a second
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
    // a switched deck is a different set of names, so they have to be measured again
  }, [rows]);

  // The list's background is television static, redrawn a few times a second. It's the
  // loudest thing on the screen after the text.
  useEffect(() => {
    const canvas = noiseRef.current;
    const ctx = canvas.getContext('2d');
    let raf = 0;
    let last = 0;

    const frame = (now) => {
      raf = requestAnimationFrame(frame);
      const gone = exitAtRef.current ? Math.min(1, (now - exitAtRef.current) / EXIT_MS) : 0;
      if (!gone && now - last < NOISE_MS) return; // losing signal, it redraws every frame
      last = now;

      // as the signal goes the static blows out to white, then decays to black
      const blowout = gone ? Math.max(0, 1 - gone * 1.4) : 0;
      const gain = 1 + 2.6 * blowout;
      const fade = gone ? Math.max(0, 1 - gone ** 1.5) : 1;

      const { width, height } = canvas;
      const image = ctx.createImageData(width, height);
      const { data } = image;
      for (let y = 0; y < height; y++) {
        // each scanline carries its own bias, which streaks the static horizontally rather
        // than leaving it an even fizz
        const line = Math.random() * 34;
        // a losing signal tears: whole bands of scanlines white out at once
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

  /**
   * The same gestures by finger. A wheel and a keyboard are all this screen had, which on a
   * phone is nothing at all.
   *
   * Dragging up and down rolls the cylinder a row at a time, as the wheel does. A swipe left
   * or right switches deck, matching the arrow keys. The axis is decided by whichever way the
   * finger has travelled furthest, so a scroll never turns into a deck switch by accident.
   */
  const touchRef = useRef(null); // { x, y, rowY, switched } while a finger is down

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

    // sideways: one deck switch per swipe, and no scrolling out of it
    if (Math.abs(dx) > Math.abs(dy)) {
      if (!start.switched && Math.abs(dx) > SWIPE_PX) {
        start.switched = true;
        switchDeck();
      }
      return;
    }
    if (start.switched || empty) return;

    // up and down: a row per row-height dragged, so the list follows the finger
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
            {/* one span per letter, each floating on its own period and phase */}
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

            {/* the deck exists, there's just nothing on it yet */}
            {empty && <p className="picker-empty">No endings of your own yet — write one and save it</p>}

            {/* keyed by the wheel position, not the ending: a short deck has the same ending
                on the wheel more than once */}
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
                  // a custom ending is never "seen": progress belongs to the game's hundred
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

        {/* where the game puts its dialogue box. While you're typing, the search takes it
            over: the controls have nothing to say that matters more than what you typed. */}
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
            {/* the ending under the cursor, counted in the deck rather than on the wheel: a
                short deck goes round more than once, but it's still N endings. And progress
                is the game's set only, so the custom deck counts itself and nothing else. */}
            {empty
              ? '000 / 000'
              : `${String((selected % deckRows.length) + 1).padStart(3, '0')} / ${String(deckRows.length).padStart(3, '0')}`}
            {!onCustom && ` · watched ${watched?.size ?? 0}`}
          </span>
        </div>
      </div>

      {/* your own writing, and there's no undo, so it asks first */}
      {pendingDelete && (
        <Confirm
          question={`THROW AWAY "${pendingDelete.label}"?`}
          confirmLabel="Delete"
          cancelLabel="Keep"
          onConfirm={() => {
            onDelete?.(pendingDelete);
            setPendingDelete(null);
            // the wheel is rebuilt around what's left, and may need a different number of
            // copies, so the cursor goes back to the top rather than at a row that's gone
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
