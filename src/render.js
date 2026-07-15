import {
  particlePositionAt,
  particleLocalT,
  exitPositionAt,
  drawSettledText,
  getDotGeometry,
  periodDotOffsets,
} from './particles.js';

export const FONT_STACK =
  '"DotGothic16", ui-monospace, Consolas, "DejaVu Sans Mono", "Liberation Mono", Menlo, Courier, monospace';

const MIN_FONT_SIZE = 14;
const HORIZONTAL_MARGIN_RATIO = 0.07; // margin on each side, as a fraction of width
const TOP_MARGIN_RATIO = 1.9; // * fontSize
const BOTTOM_PADDING_RATIO = 1.6; // * fontSize
const ENTRY_SPACING_RATIO = 2.65; // * fontSize, gap between entries
const WRAP_ROW_RATIO = 1.25; // * fontSize, gap between wrapped rows of one entry
const MIN_CANVAS_HEIGHT = 320;
const CONNECTOR_PERIODS = 3; // always three, whatever the gap or the font
const CONNECTOR_SPAN_RATIO = 0.7; // fraction of the gap the periods span, centered

function wrapWords(ctx, text, maxWidth) {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];

  const rows = [];
  let current = words[0];

  for (let i = 1; i < words.length; i++) {
    const candidate = `${current} ${words[i]}`;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
    } else {
      rows.push(current);
      current = words[i];
    }
  }
  rows.push(current);
  return rows;
}

/**
 * Turns the entries into a layout: row text and positions, connector dot positions, and
 * the canvas height needed to hold them all.
 *
 * The font size is the largest (down to MIN_FONT_SIZE) at which the longest one-line
 * entry still fits on a row; anything longer is word-wrapped at that size.
 */
export function buildLayout(ctx, entries, canvasWidth, baseFontSize) {
  const maxTextWidth = canvasWidth * (1 - HORIZONTAL_MARGIN_RATIO * 2);
  const nonEmpty = entries.filter((e) => e.text.trim().length > 0);

  // Only entries that already fit on one row at the base size get a vote in how far the
  // font shrinks. A few endings pair normal lines with a 400-character paragraph, which
  // wraps whatever the size; letting it drive the shrink loop pinned the whole chain at
  // MIN_FONT_SIZE. If nothing fits at the base size, shrinking can't get anything onto
  // one row either, so don't shrink at all.
  ctx.font = `${baseFontSize}px ${FONT_STACK}`;
  const fittable = nonEmpty.filter((e) => ctx.measureText(e.text).width <= maxTextWidth);

  let fontSize = baseFontSize;
  if (fittable.length > 0) {
    while (fontSize > MIN_FONT_SIZE) {
      ctx.font = `${fontSize}px ${FONT_STACK}`;
      const longest = Math.max(...fittable.map((e) => ctx.measureText(e.text).width));
      if (longest <= maxTextWidth) break;
      fontSize -= 1;
    }
  }

  ctx.font = `${fontSize}px ${FONT_STACK}`;

  const rows = []; // { text, red, isFirstRowOfEntry, entryIndex, center }
  nonEmpty.forEach((entry, entryIndex) => {
    const width = ctx.measureText(entry.text).width;
    const lines = width <= maxTextWidth ? [entry.text] : wrapWords(ctx, entry.text, maxTextWidth);
    lines.forEach((line, i) => {
      rows.push({ text: line, red: entry.red, isFirstRowOfEntry: i === 0, entryIndex });
    });
  });

  const topMargin = fontSize * TOP_MARGIN_RATIO;
  let y = topMargin;
  rows.forEach((row, i) => {
    if (i > 0) {
      y += rows[i].isFirstRowOfEntry ? fontSize * ENTRY_SPACING_RATIO : fontSize * WRAP_ROW_RATIO;
    }
    row.center = y;
  });

  const canvasHeight =
    rows.length === 0
      ? Math.max(MIN_CANVAS_HEIGHT, baseFontSize * TOP_MARGIN_RATIO * 2)
      : Math.max(MIN_CANVAS_HEIGHT, Math.round(y + fontSize * BOTTOM_PADDING_RATIO));

  // Connectors bridge distinct entries, not the wrapped rows of one entry, and clear the
  // real glyph bounds rather than the row centers. measureText reports those bounds
  // relative to the current textBaseline, so it must match the baseline the text is drawn
  // with: against the default (alphabetic) the connector's top lands inside the line above.
  ctx.textBaseline = 'middle';
  const connectors = [];
  for (let i = 0; i < rows.length - 1; i++) {
    if (!rows[i + 1].isFirstRowOfEntry) continue;
    const above = ctx.measureText(rows[i].text);
    const below = ctx.measureText(rows[i + 1].text);
    const yStart = rows[i].center + (above.actualBoundingBoxDescent || fontSize * 0.4);
    const yEnd = rows[i + 1].center - (below.actualBoundingBoxAscent || fontSize * 0.4);
    const gap = yEnd - yStart;
    if (gap <= 0) {
      connectors.push({ afterRowIndex: i, yStart, yEnd, dotYs: [] });
      continue;
    }
    const usable = gap * CONNECTOR_SPAN_RATIO;
    const margin = (gap - usable) / 2;
    const dotYs = [];
    for (let d = 0; d < CONNECTOR_PERIODS; d++) {
      dotYs.push(yStart + margin + (d / (CONNECTOR_PERIODS - 1)) * usable);
    }
    connectors.push({ afterRowIndex: i, yStart, yEnd, dotYs });
  }

  return { fontSize, canvasWidth, canvasHeight, cx: canvasWidth / 2, rows, connectors };
}

export function fullRevealState(layout) {
  return {
    rowProgress: layout.rows.map(() => 1),
    connectorDotProgress: layout.connectors.map((c) => c.dotYs.map(() => 1)),
    dissolve: 0,
  };
}

const SPAWN_FRAC = 0.15; // of a row's progress: scattered, before the particles set off
const SETTLE_FRAC = 0.8; // of a row's progress: after this the arrived cloud crossfades into the text
const PARTICLE_ALPHA = 0.85;
// Periods are drawn in the text color at full brightness, even above a red line: in-game
// their dots are pixel-identical to the ones the letters are made of.
const DOT_PARTICLE_ALPHA = 1;

function drawParticleAt(ctx, x, y, size, alpha, color) {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.fillRect(x - size / 2, y - size / 2, size, size);
}

/**
 * Draws one row at a given materialize progress (0 = not started, 1 = settled).
 *
 * Particles spawn scattered, fly along curved paths to points sampled from the real
 * glyphs (particles.js), and once they arrive the cloud already has the shape of the
 * word, so the last stretch crossfades it into the settled text. The particles assemble
 * the letters; they don't stand in for them.
 *
 * With no particle plan (the static and export path) or at progress 1, draws the text.
 */
function drawRowParticles(ctx, layout, row, progress, color, particles) {
  if (progress <= 0) return;

  if (progress >= 1 || !particles || particles.length === 0) {
    ctx.globalAlpha = 1;
    drawSettledText(ctx, layout, row, color);
    return;
  }

  const { dotSize } = getDotGeometry(layout.fontSize);

  if (progress < SPAWN_FRAC) {
    const alpha = (progress / SPAWN_FRAC) * PARTICLE_ALPHA;
    particles.forEach((p) => drawParticleAt(ctx, p.startX, p.startY, dotSize, alpha, color));
    return;
  }

  const settle = progress <= SETTLE_FRAC ? 0 : (progress - SETTLE_FRAC) / (1 - SETTLE_FRAC);

  const travelProgress = (progress - SPAWN_FRAC) / (1 - SPAWN_FRAC);
  particles.forEach((p) => {
    const t = particleLocalT(p, travelProgress);
    const { x, y } = particlePositionAt(p, t);
    drawParticleAt(ctx, x, y, dotSize, PARTICLE_ALPHA * (1 - settle), color);
  });

  if (settle > 0) drawSettledText(ctx, layout, row, color, settle);
}

/**
 * Draws one connector period at a given progress. A period is four dots in a 2x2 square
 * (periodDotOffsets), on the same pitch as the letters. No crossfade, unlike text: a
 * settled period is those four squares, which is already what its arrived particles are.
 */
function drawPeriod(ctx, layout, connector, dotIndex, progress, particles, color) {
  if (progress <= 0) return;

  const { dotSize } = getDotGeometry(layout.fontSize);
  const dotY = connector.dotYs[dotIndex];

  if (progress >= 1 || !particles) {
    periodDotOffsets(layout.fontSize).forEach(([ox, oy]) => {
      drawParticleAt(ctx, layout.cx + ox, dotY + oy, dotSize, DOT_PARTICLE_ALPHA, color);
    });
    return;
  }

  if (progress < SPAWN_FRAC) {
    const alpha = (progress / SPAWN_FRAC) * DOT_PARTICLE_ALPHA;
    particles.forEach((p) => drawParticleAt(ctx, p.startX, p.startY, dotSize, alpha, color));
    return;
  }

  const travelProgress = (progress - SPAWN_FRAC) / (1 - SPAWN_FRAC);
  particles.forEach((p) => {
    const t = particleLocalT(p, travelProgress);
    const { x, y } = particlePositionAt(p, t);
    drawParticleAt(ctx, x, y, dotSize, DOT_PARTICLE_ALPHA, color);
  });
}

/**
 * Draws a set of dots coming undone: each drifts off the position it settled into and
 * fades (exitPositionAt). Text and connector dots let go together, at the end of the chain.
 */
function drawExitParticles(ctx, particles, dissolve, size, baseAlpha, color) {
  if (!particles) return;
  particles.forEach((p) => {
    const { x, y, alpha } = exitPositionAt(p, dissolve);
    if (alpha <= 0) return;
    drawParticleAt(ctx, x, y, size, baseAlpha * alpha, color);
  });
}

/**
 * Draws one frame at a given reveal state. rowProgress[i] is how far row i has
 * materialized, connectorDotProgress[j][d] how far dot d of connector j has converged,
 * dissolve how far the finished chain has come undone (0 = settled, 1 = every dot gone).
 * particlePlan supplies the paths; omit it for the static render, which is settled text.
 *
 * viewportHeight makes the canvas a fixed window onto the layout, scrolled to
 * revealState.cameraY: that is playback. Omit it and the canvas is the whole chain at
 * once with no camera, which is the static frame and the PNG export.
 */
export function drawFrame(canvas, layout, { textColor, redColor }, revealState, particlePlan, viewportHeight) {
  const ctx = canvas.getContext('2d');
  const height = viewportHeight ?? layout.canvasHeight;
  canvas.width = layout.canvasWidth;
  canvas.height = height;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, layout.canvasWidth, height);

  // Everything below draws in layout coordinates; the camera is just a shift. Rounded:
  // the settled text is a bitmap with 1px grooves cut through it, and a fractional offset
  // blurs those gaps back into solid strokes.
  const cameraY = viewportHeight ? Math.round(revealState.cameraY ?? 0) : 0;
  ctx.translate(0, -cameraY);

  const dissolve = particlePlan ? (revealState.dissolve ?? 0) : 0;
  const { dotSize } = getDotGeometry(layout.fontSize);

  if (dissolve > 0) {
    layout.connectors.forEach((_, idx) => {
      drawExitParticles(ctx, particlePlan.connectorExits[idx], dissolve, dotSize, DOT_PARTICLE_ALPHA, textColor);
    });
    layout.rows.forEach((row, i) => {
      const color = row.red ? redColor : textColor;
      drawExitParticles(ctx, particlePlan.rowExits[i], dissolve, dotSize, 1, color);
    });
  } else {
    layout.connectors.forEach((connector, idx) => {
      const dotProgress = revealState.connectorDotProgress[idx];
      if (!dotProgress) return;
      connector.dotYs.forEach((_, d) => {
        const particles = particlePlan?.connectorParticles[idx]?.[d];
        drawPeriod(ctx, layout, connector, d, dotProgress[d] ?? 0, particles, textColor);
      });
    });
    ctx.globalAlpha = 1;

    layout.rows.forEach((row, i) => {
      const progress = revealState.rowProgress[i] ?? 0;
      const particles = particlePlan?.rowParticles[i];
      drawRowParticles(ctx, layout, row, progress, row.red ? redColor : textColor, particles);
    });
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
}

export function renderBlackout(canvas, { entries, fontSize: baseFontSize, canvasWidth, textColor, redColor }) {
  const ctx = canvas.getContext('2d');
  const layout = buildLayout(ctx, entries, canvasWidth, baseFontSize);
  drawFrame(canvas, layout, { textColor, redColor }, fullRevealState(layout));
}
