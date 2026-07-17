const BEAT_MS = 650;
const DOT_MS = BEAT_MS; 
const MATERIALIZE_MS = BEAT_MS * 3;
const PAUSE_BEFORE_DOTS_MS = 0;
const PAUSE_AFTER_DOTS_MS = 0;
const HOLD_MS = 0;
const PAUSE_BEFORE_DISSOLVE_MS = BEAT_MS * 6; 
const DISSOLVE_MS = BEAT_MS * 4; 
export function buildSchedule(layout, viewportHeight = layout.canvasHeight, audio = {}) {
  const segments = [];
  const cues = []; 
  let t = 0;
  const groups = [];
  layout.rows.forEach((row, i) => {
    if (row.isFirstRowOfEntry || groups.length === 0) groups.push([i]);
    else groups[groups.length - 1].push(i);
  });
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
      segments.push({
        kind: 'dots',
        connectorIndex,
        dotCount: connector.dotYs.length,
        cameraFrom: camera,
        cameraTo,
        start: t,
        end: t + dotsDur,
      });
      if (audio.period) {
        connector.dotYs.forEach((_, d) => cues.push({ clip: audio.period, time: t + d * DOT_MS }));
      }
      t += dotsDur + PAUSE_AFTER_DOTS_MS;
    }
    camera = cameraTo;
    if (audio.lines?.[g]) cues.push({ clip: audio.lines[g], time: t });
    segments.push({ kind: 'materialize', rowIndices, camera, start: t, end: t + MATERIALIZE_MS });
    t += MATERIALIZE_MS;
    t += HOLD_MS;
  });
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
  const connectorDotProgress = layout.connectors.map((c) => new Array(c.dotYs.length).fill(0));
  let dissolve = 0; 
  let cameraY = schedule.initialCamera ?? 0;
  for (const seg of schedule.segments) {
    if (elapsedMs <= seg.start) continue;
    const progress = seg.end > seg.start ? Math.min(1, (elapsedMs - seg.start) / (seg.end - seg.start)) : 1;
    if (seg.kind === 'dissolve') {
      dissolve = progress;
      cameraY = seg.camera;
    } else if (seg.kind === 'dots') {
      const eased = progress * progress * (3 - 2 * progress); 
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