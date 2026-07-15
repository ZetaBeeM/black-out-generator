/**
 * Timings, in beats. Every event in the ending lands on a 650ms beat: the words form over
 * 3 beats, the three connector periods blip on the next 3, and the following line starts
 * immediately. A continuous 6-beat cycle, which is why the pauses are all zero. These are
 * measured values, not eyeballed ones; don't retune them by feel.
 */
const BEAT_MS = 650;
const DOT_MS = BEAT_MS; // one period per beat; also paces the scroll, which rides the same segment
const MATERIALIZE_MS = BEAT_MS * 3;
const PAUSE_BEFORE_DOTS_MS = 0;
const PAUSE_AFTER_DOTS_MS = 0;
const HOLD_MS = 0;
const PAUSE_BEFORE_DISSOLVE_MS = BEAT_MS * 6; // the chain sits complete before letting go
const DISSOLVE_MS = BEAT_MS * 4; // the length of the dissolve sound

/**
 * Builds a flat timeline of segments (dots, materialize, dissolve) in playback order,
 * plus the audio cues and the camera position for each one.
 *
 * Rows of the same entry (wrapped text) share one materialize segment, so they form
 * together. Every segment carries its own [start, end] in ms, so the reveal state at
 * any elapsed time is computed directly rather than accumulated frame to frame; that
 * is what makes playback survive dropped frames and lets the exporter render frames
 * at arbitrary timestamps.
 *
 * Only progress (0-1) per row and per connector dot is tracked here. particles.js and
 * render.js turn that into positions.
 */
export function buildSchedule(layout, viewportHeight = layout.canvasHeight, audio = {}) {
  const segments = [];
  const cues = []; // { clip, time }: audio to start at a given elapsed time
  let t = 0;

  const groups = [];
  layout.rows.forEach((row, i) => {
    if (row.isFirstRowOfEntry || groups.length === 0) groups.push([i]);
    else groups[groups.length - 1].push(i);
  });

  // Puts an entry's rows on the centerline. Deliberately not clamped to the top of the
  // layout: the first line is centered with empty space above it, as in-game, rather
  // than pinned to the top edge.
  const cameraFor = (rowIndices) => {
    const centers = rowIndices.map((i) => layout.rows[i].center);
    const mid = (Math.min(...centers) + Math.max(...centers)) / 2;
    return mid - viewportHeight / 2;
  };

  const initialCamera = groups.length > 0 ? cameraFor(groups[0]) : 0;
  let camera = initialCamera;

  groups.forEach((rowIndices, g) => {
    const cameraTo = cameraFor(rowIndices);
    const connectorIndex =
      g > 0 ? layout.connectors.findIndex((c) => c.afterRowIndex === rowIndices[0] - 1) : -1;
    const connector = connectorIndex === -1 ? null : layout.connectors[connectorIndex];

    const dotsDur = connector ? Math.max(1, connector.dotYs.length) * DOT_MS : 0;

    if (connector) {
      t += PAUSE_BEFORE_DOTS_MS;
      // the scroll rides the connector segment, so the chain pulls the next line up
      // into the center as the periods are drawn
      segments.push({
        kind: 'dots',
        connectorIndex,
        dotCount: connector.dotYs.length,
        cameraFrom: camera,
        cameraTo,
        start: t,
        end: t + dotsDur,
      });
      // one blip per period, each on its own beat
      if (audio.period) {
        connector.dotYs.forEach((_, d) => cues.push({ clip: audio.period, time: t + d * DOT_MS }));
      }
      t += dotsDur + PAUSE_AFTER_DOTS_MS;
    }

    camera = cameraTo;

    // The line's sound starts as its words start forming, but its length does not pace
    // them: the clips carry 1-1.8s of trailing silence after the audible burst, so
    // driving the materialize off the file length forms the words 2-3x too slowly.
    // 3 beats, and the clip's tail rings out over the periods below it.
    if (audio.lines?.[g]) cues.push({ clip: audio.lines[g], time: t });
    segments.push({ kind: 'materialize', rowIndices, camera, start: t, end: t + MATERIALIZE_MS });
    t += MATERIALIZE_MS;
    t += HOLD_MS;
  });

  // every dot on screen, glyphs and periods alike, comes undone at once (makeExitParticle).
  // the camera stays where it ended up, on the final line.
  if (groups.length > 0) {
    t += PAUSE_BEFORE_DISSOLVE_MS;
    if (audio.dissolve) cues.push({ clip: audio.dissolve, time: t });
    segments.push({ kind: 'dissolve', camera, start: t, end: t + DISSOLVE_MS });
    t += DISSOLVE_MS;
  }

  return { segments, cues, totalDuration: t, initialCamera, viewportHeight };
}

export function computeRevealState(layout, schedule, elapsedMs) {
  const rowProgress = new Array(layout.rows.length).fill(0);
  // each dot gets its own slice of its connector's segment: they form top to bottom,
  // and each one animates 0 (unformed) to 1 (converged) rather than popping in
  const connectorDotProgress = layout.connectors.map((c) => new Array(c.dotYs.length).fill(0));
  let dissolve = 0; // 0 = settled, 1 = every dot has drifted away
  let cameraY = schedule.initialCamera ?? 0;

  for (const seg of schedule.segments) {
    if (elapsedMs <= seg.start) continue;
    const progress = seg.end > seg.start ? Math.min(1, (elapsedMs - seg.start) / (seg.end - seg.start)) : 1;

    if (seg.kind === 'dissolve') {
      dissolve = progress;
      cameraY = seg.camera;
    } else if (seg.kind === 'dots') {
      const eased = progress * progress * (3 - 2 * progress); // smoothstep: the scroll eases in and out
      cameraY = seg.cameraFrom + (seg.cameraTo - seg.cameraFrom) * eased;
      const dotCount = seg.dotCount;
      const dotProgress = connectorDotProgress[seg.connectorIndex];
      for (let d = 0; d < dotCount; d++) {
        const sliceStart = d / dotCount;
        const sliceEnd = (d + 1) / dotCount;
        dotProgress[d] = Math.min(1, Math.max(0, (progress - sliceStart) / (sliceEnd - sliceStart)));
      }
    } else if (seg.kind === 'materialize') {
      cameraY = seg.camera;
      seg.rowIndices.forEach((idx) => {
        rowProgress[idx] = progress;
      });
    }
  }

  return { rowProgress, connectorDotProgress, dissolve, cameraY };
}
