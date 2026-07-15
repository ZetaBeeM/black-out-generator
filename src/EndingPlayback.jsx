import { useEffect, useRef, useState } from 'react';
import { buildLayout, drawFrame } from './render.js';
import { buildSchedule, computeRevealState } from './animate.js';
import { buildParticlePlan } from './particles.js';
import { pickSounds, playClip, stopClip } from './audio.js';

/**
 * The ending playing to an empty screen, which is the whole display, as in the game. The
 * middle of the flow: the picker hands it a chain, and it hands the editor over once the
 * chain has come undone.
 *
 * It builds its own layout, schedule and particles at 720p rather than borrowing the
 * editor's, which previews at its own canvas width. Not a new kind of animation: it drives
 * the same pure computeRevealState + drawFrame the preview and the exporter do.
 */
const PLAY_WIDTH = 1280;
const PLAY_HEIGHT = 720;

// the empty screen holds for a beat before the editor arrives, rather than cutting from the
// last dot to a page full of form controls
const LINGER_MS = 2200;

export default function EndingPlayback({ entries, colors, fontSize, canvasWidth, bank, ready, onDone }) {
  const [skippable, setSkippable] = useState(false);
  const [over, setOver] = useState(false); // played out; holding on black
  const canvasRef = useRef(null);
  const rafRef = useRef(0);
  const cuesRef = useRef([]);
  const doneRef = useRef(onDone);
  const completedRef = useRef(false);

  doneRef.current = onDone;

  useEffect(() => {
    if (!ready) return undefined;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');

    // the editor's font size is relative to the editor's canvas width, so scale it exactly
    // the way the video export does
    const layout = buildLayout(ctx, entries, PLAY_WIDTH, (fontSize * PLAY_WIDTH) / canvasWidth);
    const lineCount = entries.filter((e) => e.text.trim()).length;
    const audio = bank
      ? { lines: pickSounds(bank, lineCount), period: bank.period, dissolve: bank.dissolve }
      : {};
    const schedule = buildSchedule(layout, PLAY_HEIGHT, audio);
    const plan = buildParticlePlan(layout);
    cuesRef.current = schedule.cues;

    const start = performance.now();
    let next = 0;

    const frame = (now) => {
      const elapsed = now - start;
      drawFrame(canvas, layout, colors, computeRevealState(layout, schedule, elapsed), plan, PLAY_HEIGHT);

      while (next < schedule.cues.length && elapsed >= schedule.cues[next].time) {
        playClip(schedule.cues[next].clip, elapsed - schedule.cues[next].time);
        next += 1;
      }

      if (elapsed < schedule.totalDuration) {
        rafRef.current = requestAnimationFrame(frame);
      } else {
        // watched all the way through, which is what marks it watched. the screen is empty
        // by now, so hold it there before handing over.
        completedRef.current = true;
        setOver(true);
        linger = setTimeout(() => doneRef.current(true), LINGER_MS);
      }
    };

    rafRef.current = requestAnimationFrame(frame);
    // a moment's grace, so the keypress that picked the ending can't also skip it
    const grace = setTimeout(() => setSkippable(true), 700);
    let linger = 0;

    return () => {
      cancelAnimationFrame(rafRef.current);
      clearTimeout(grace);
      clearTimeout(linger);
      schedule.cues.forEach(({ clip }) => stopClip(clip));
    };
  }, [ready, entries, colors, fontSize, canvasWidth, bank]);

  useEffect(() => {
    if (!skippable) return undefined;
    // cutting the final hold short still counts as watched; skipping the ending itself doesn't
    const skip = () => doneRef.current(completedRef.current);
    window.addEventListener('keydown', skip);
    window.addEventListener('mousedown', skip);
    return () => {
      window.removeEventListener('keydown', skip);
      window.removeEventListener('mousedown', skip);
    };
  }, [skippable]);

  return (
    <div className="playback">
      <canvas ref={canvasRef} width={PLAY_WIDTH} height={PLAY_HEIGHT} />
      {skippable && !over && <p className="playback-skip">Press any key to skip</p>}
    </div>
  );
}
