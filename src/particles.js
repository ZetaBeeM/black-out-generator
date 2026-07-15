import { FONT_STACK } from './render.js';

let scratchCanvas = null;

function getScratchCtx() {
  if (!scratchCanvas) scratchCanvas = document.createElement('canvas');
  return scratchCanvas.getContext('2d', { willReadFrequently: true });
}

const ALPHA_THRESHOLD = 100;
const EM_CELLS = 16; // DotGothic16 draws its glyphs on a 16x16 grid per em
const DOT_FILL_RATIO = 0.75; // dot size as a fraction of the pitch; the rest is the gap
const MAX_CELLS = 60000; // grid cap for very long lines: coarsen the pitch rather than explode the particle count

/**
 * Pitch and size of the dots the letters are made of.
 *
 * The pitch is the font's own pixel grid (an em / EM_CELLS). The settled text is grooved
 * along it and the particles are sampled and drawn at it, so a particle arriving at its
 * target already looks like the dot it is about to become. Anything coarser stops
 * following the letterforms: strokes fatten to the pitch and neighbouring letters merge.
 */
export function getDotGeometry(fontSize) {
  const step = Math.max(2, Math.round(fontSize / EM_CELLS));
  const dotSize = Math.max(1, step * DOT_FILL_RATIO);
  return { step, dotSize };
}

/**
 * Renders `text` to a scratch canvas and samples its lit pixels on the grid pitch. The
 * points are the targets the particles converge to, so the cloud takes the shape of the
 * real word rather than a generic blob.
 */
export function sampleGlyphPoints(fontSize, text) {
  const measureCtx = getScratchCtx();
  measureCtx.font = `${fontSize}px ${FONT_STACK}`;
  const width = Math.max(1, Math.ceil(measureCtx.measureText(text).width));
  const height = Math.ceil(fontSize * 2);

  scratchCanvas.width = width;
  scratchCanvas.height = height;
  const ctx = getScratchCtx(); // canvas resize resets context state, re-fetch
  ctx.font = `${fontSize}px ${FONT_STACK}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fff';
  ctx.fillText(text, 0, height / 2);

  let { step } = getDotGeometry(fontSize);
  const estimatedCells = Math.ceil(width / step) * Math.ceil(height / step);
  if (estimatedCells > MAX_CELLS) {
    step = Math.max(step, Math.ceil(Math.sqrt((width * height) / MAX_CELLS)));
  }

  const { data } = ctx.getImageData(0, 0, width, height);

  // Check the whole cell for ink, not one pixel of it: sampling a single pixel per cell
  // misses thin strokes whenever the grid phase doesn't land on them, which breaks
  // letters apart into noise.
  const points = [];
  for (let cellY = 0; cellY < height; cellY += step) {
    const yEnd = Math.min(height, cellY + step);
    for (let cellX = 0; cellX < width; cellX += step) {
      const xEnd = Math.min(width, cellX + step);
      let hit = false;
      for (let y = cellY; y < yEnd && !hit; y++) {
        for (let x = cellX; x < xEnd; x++) {
          if (data[(y * width + x) * 4 + 3] > ALPHA_THRESHOLD) {
            hit = true;
            break;
          }
        }
      }
      if (hit) {
        points.push({ localX: cellX + step / 2, localY: cellY + step / 2 - height / 2 });
      }
    }
  }
  return { points, width, step };
}

function makeParticle(startX, startY, targetX, targetY, fontSize) {
  const dx = targetX - startX;
  const dy = targetY - startY;
  const len = Math.hypot(dx, dy) || 1;
  const px = -dy / len;
  const py = dx / len;
  const bow = (Math.random() * 2 - 1) * fontSize * (1.2 + Math.random() * 1.3);
  return {
    startX,
    startY,
    targetX,
    targetY,
    controlX: (startX + targetX) / 2 + px * bow,
    controlY: (startY + targetY) / 2 + py * bow,
    delay: Math.random() * 0.3,
    wiggleFreq: 2 + Math.random() * 2,
    wiggleAmp: fontSize * (0.05 + Math.random() * 0.1),
    wigglePhase: Math.random() * Math.PI * 2,
  };
}

/**
 * A period is four dots in a 2x2 square on the same pitch as the letters, not one dot.
 * These are their offsets from the center of the period.
 */
export function periodDotOffsets(fontSize) {
  const { step } = getDotGeometry(fontSize);
  const o = step / 2;
  return [
    [-o, -o],
    [o, -o],
    [-o, o],
    [o, o],
  ];
}

/**
 * A dot that has come undone from the settled text and is drifting away. The whole screen
 * lets go at once: dots lift off, spread outward from the middle, mostly rise, and thin
 * out. Hence the outward drift, the upward bias, and the stagger, which frays the text
 * rather than lifting it off in one sheet.
 */
function makeExitParticle(x, y, cx, fontSize) {
  const outward = ((x - cx) / Math.max(1, fontSize * 8)) * fontSize * 1.4;
  return {
    x,
    y,
    vx: outward + (Math.random() * 2 - 1) * fontSize * 2.2,
    vy: -fontSize * (1.4 + Math.random() * 2.6), // upward, but see drawExitParticles
    delay: Math.random() * 0.4,
    wiggleFreq: 1.5 + Math.random() * 2.5,
    wiggleAmp: fontSize * (0.15 + Math.random() * 0.35),
    wigglePhase: Math.random() * Math.PI * 2,
  };
}

/**
 * Builds every particle a layout needs, once per playback: a cluster per row, converging
 * into that row's glyphs, and four per connector period. Each starts scattered near where
 * it will end up and travels a curved, wiggling path (particlePositionAt), so the cloud
 * reads as dots assembling rather than snapping into place.
 *
 * Every dot also gets an exit particle, built from the same sampled point, which takes
 * over when the chain comes undone. So a dot drifts away from exactly where it settled.
 */
export function buildParticlePlan(layout) {
  const rowParticles = [];
  const rowExits = [];

  layout.rows.forEach((row) => {
    if (!row.text.trim()) {
      rowParticles.push([]);
      rowExits.push([]);
      return;
    }
    const { points, width } = sampleGlyphPoints(layout.fontSize, row.text);
    const originX = layout.cx - width / 2;
    const bandHalfWidth = Math.max(width * 0.75, layout.fontSize * 3);

    const entry = [];
    const exit = [];
    points.forEach(({ localX, localY }) => {
      const targetX = originX + localX;
      const targetY = row.center + localY;
      const startX = layout.cx + (Math.random() * 2 - 1) * bandHalfWidth;
      const startY = row.center + layout.fontSize * (0.3 + Math.random() * 1.5);
      entry.push(makeParticle(startX, startY, targetX, targetY, layout.fontSize));
      exit.push(makeExitParticle(targetX, targetY, layout.cx, layout.fontSize));
    });
    rowParticles.push(entry);
    rowExits.push(exit);
  });

  // one particle per dot of each period, i.e. four per period
  const offsets = periodDotOffsets(layout.fontSize);

  const connectorParticles = layout.connectors.map((connector) =>
    connector.dotYs.map((dotY) =>
      offsets.map(([ox, oy]) => {
        const startX = layout.cx + (Math.random() * 2 - 1) * layout.fontSize;
        const startY = connector.yStart + Math.random() * (connector.yEnd - connector.yStart);
        return makeParticle(startX, startY, layout.cx + ox, dotY + oy, layout.fontSize);
      }),
    ),
  );

  const connectorExits = layout.connectors.map((connector) =>
    connector.dotYs.flatMap((dotY) =>
      offsets.map(([ox, oy]) => makeExitParticle(layout.cx + ox, dotY + oy, layout.cx, layout.fontSize)),
    ),
  );

  return { rowParticles, connectorParticles, rowExits, connectorExits };
}

/**
 * Position and remaining opacity of an exit particle at dissolve progress t. Displacement
 * accelerates (t^2), so dots creep off the glyph before flying, and opacity falls away
 * over the back half, so the cloud thins out rather than cutting to black.
 */
export function exitPositionAt(particle, t) {
  const local = Math.min(1, Math.max(0, (t - particle.delay) / (1 - particle.delay)));
  const travel = local * local;
  const wiggle =
    Math.sin(local * particle.wiggleFreq * Math.PI * 2 + particle.wigglePhase) * particle.wiggleAmp * local;
  return {
    x: particle.x + particle.vx * travel + wiggle,
    y: particle.y + particle.vy * travel,
    alpha: 1 - local * local,
  };
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Position of a particle at local travel progress t (0 = start, 1 = arrived at target). */
export function particlePositionAt(particle, t) {
  const eased = 1 - (1 - t) * (1 - t); // ease-out quad
  const bx = lerp(particle.startX, particle.controlX, eased);
  const by = lerp(particle.startY, particle.controlY, eased);
  const cx = lerp(particle.controlX, particle.targetX, eased);
  const cy = lerp(particle.controlY, particle.targetY, eased);
  let x = lerp(bx, cx, eased);
  let y = lerp(by, cy, eased);

  const decay = 1 - eased; // wiggle dies out as the particle arrives
  const dx = particle.targetX - particle.startX;
  const dy = particle.targetY - particle.startY;
  const len = Math.hypot(dx, dy) || 1;
  const px = -dy / len;
  const py = dx / len;
  const wiggle = Math.sin(eased * particle.wiggleFreq * Math.PI + particle.wigglePhase) * particle.wiggleAmp * decay;
  x += px * wiggle;
  y += py * wiggle;
  return { x, y };
}

/** Maps a particle's overall local progress (accounting for its stagger delay) to travel-curve t. */
export function particleLocalT(particle, travelProgress) {
  if (particle.delay >= 1) return travelProgress >= 1 ? 1 : 0;
  return Math.min(1, Math.max(0, (travelProgress - particle.delay) / (1 - particle.delay)));
}

/**
 * Picks the grid phase (0..step-1) whose gaps fall on the least ink, given per-column or
 * per-row ink totals.
 *
 * The gaps have to land between the font's pixels, not through them, and where fillText
 * puts those pixels depends on the glyph metrics and the text's subpixel position. So the
 * phase is measured rather than assumed: the right one erases the least ink.
 */
function bestGridPhase(inkPerLine, step, dotSize) {
  const gapStart = Math.round(dotSize);
  const gapWidth = Math.max(1, step - gapStart);

  let bestPhase = 0;
  let bestInk = Infinity;
  for (let phase = 0; phase < step; phase++) {
    let ink = 0;
    for (let i = 0; i < inkPerLine.length; i++) {
      const offset = (((i - phase) % step) + step) % step;
      if (offset >= gapStart && offset < gapStart + gapWidth) ink += inkPerLine[i];
    }
    if (ink < bestInk) {
      bestInk = ink;
      bestPhase = phase;
    }
  }
  return bestPhase;
}

let textCanvas = null;

/**
 * Draws a row's settled text: the glyphs with a thin gap cut between each of their
 * pixels, so a letter reads as a cluster of squares rather than a solid stroke.
 *
 * The text is drawn normally and then grooved along the font's own pixel grid, rather
 * than rebuilt out of squares on a grid of our own. Re-quantizing the glyphs that way
 * fattens every stroke to the grid pitch and merges neighbouring letters into blobs.
 *
 * That grid is also where the particles are sampled and the size they're drawn at, so the
 * arrived cloud and this text are near-identical and the crossfade between them in
 * drawRowParticles is invisible.
 */
export function drawSettledText(ctx, layout, row, color, alpha = 1) {
  const { fontSize } = layout;
  const { step, dotSize } = getDotGeometry(fontSize);
  const font = `${fontSize}px ${FONT_STACK}`;

  if (!textCanvas) textCanvas = document.createElement('canvas');
  const tctx = textCanvas.getContext('2d', { willReadFrequently: true });
  tctx.font = font;

  const pad = step * 2;
  const width = Math.ceil(tctx.measureText(row.text).width) + pad * 2;
  const height = Math.ceil(fontSize * 2) + pad * 2;
  textCanvas.width = width;
  textCanvas.height = height;

  const ctx2 = textCanvas.getContext('2d', { willReadFrequently: true }); // resize resets state
  ctx2.font = font;
  ctx2.textAlign = 'left';
  ctx2.textBaseline = 'middle';
  ctx2.fillStyle = color;
  ctx2.fillText(row.text, pad, Math.round(height / 2));

  const { data } = ctx2.getImageData(0, 0, width, height);
  const inkPerColumn = new Float64Array(width);
  const inkPerRow = new Float64Array(height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = data[(y * width + x) * 4 + 3];
      if (a > ALPHA_THRESHOLD) {
        inkPerColumn[x] += a;
        inkPerRow[y] += a;
      }
    }
  }

  const phaseX = bestGridPhase(inkPerColumn, step, dotSize);
  const phaseY = bestGridPhase(inkPerRow, step, dotSize);
  const gap = step - dotSize;

  ctx2.globalCompositeOperation = 'destination-out';
  ctx2.fillStyle = '#000';
  for (let x = phaseX + dotSize; x < width; x += step) ctx2.fillRect(x, 0, gap, height);
  for (let y = phaseY + dotSize; y < height; y += step) ctx2.fillRect(0, y, width, gap);

  // integer destination: a half-pixel offset blurs every groove back into a solid stroke
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.drawImage(
    textCanvas,
    Math.round(layout.cx - width / 2),
    Math.round(row.center - height / 2),
  );
  ctx.restore();
}
