import { useEffect, useRef, useState } from 'react';
import { buildLayout, drawFrame } from './render.js';
import { buildSchedule, computeRevealState } from './animate.js';
import { buildParticlePlan } from './particles.js';
import { pickSounds, playClip, stopClip } from './audio.js';

const PLAY_WIDTH = 1280;
const PLAY_HEIGHT = 720;
const LINGER_MS = 2200;
export default function EndingPlayback({ entries, colors, fontSize, canvasWidth, bank, ready, onDone }) {
  const [skippable, setSkippable] = useState(false);
  const [over, setOver] = useState(false); 
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
        completedRef.current = true;
        setOver(true);
        linger = setTimeout(() => doneRef.current(true), LINGER_MS);
      }
    };
    rafRef.current = requestAnimationFrame(frame);
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
