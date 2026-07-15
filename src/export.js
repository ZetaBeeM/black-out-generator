import { Muxer as Mp4Muxer, ArrayBufferTarget as Mp4Target } from 'mp4-muxer';
import { Muxer as WebmMuxer, ArrayBufferTarget as WebmTarget } from 'webm-muxer';
import { buildLayout, drawFrame } from './render.js';
import { buildSchedule, computeRevealState } from './animate.js';
import { buildParticlePlan } from './particles.js';

export const EXPORT_WIDTH = 1280;
export const EXPORT_HEIGHT = 720; // 16:9, the playback viewport's aspect
const FPS = 60;
const VIDEO_BITRATE = 8_000_000;
const AUDIO_SAMPLE_RATE = 48000;
const AUDIO_BITRATE = 128_000;
const KEYFRAME_INTERVAL = FPS * 2;
const TAIL_MS = 400; // let the dissolve's sound ring out past the last frame

export function canExportVideo() {
  return typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';
}

/**
 * What a browser can encode is a different question from what it can play, and a
 * different question again from what isConfigSupported() reports: Firefox answered
 * supported: true for H.264 and then threw NotSupportedError from configure(). So the
 * query isn't trusted. Each candidate is probed by configuring a real encoder and pushing
 * a frame through it (probeVideo/probeAudio).
 *
 * Most portable first. H.264, VP9 and AV1 mux into MP4; VP8 cannot, so a browser that
 * only encodes VP8 gets a WebM. The container follows from the codec.
 */
const VIDEO_CANDIDATES = [
  { codec: 'avc1.4d0028', muxer: 'avc', container: 'mp4' }, // H.264 main
  { codec: 'avc1.42001f', muxer: 'avc', container: 'mp4' }, // H.264 baseline
  { codec: 'vp09.00.10.08', muxer: 'vp9', container: 'mp4' },
  { codec: 'av01.0.04M.08', muxer: 'av1', container: 'mp4' },
  { codec: 'vp8', muxer: 'V_VP8', container: 'webm' },
];

const AUDIO_CANDIDATES = [
  { codec: 'mp4a.40.2', muxer: 'aac', containers: ['mp4'] }, // AAC-LC
  { codec: 'opus', muxer: 'opus', containers: ['mp4', 'webm'] },
];

function videoConfig(codec) {
  return { codec, width: EXPORT_WIDTH, height: EXPORT_HEIGHT, bitrate: VIDEO_BITRATE, framerate: FPS };
}

function audioConfig(codec) {
  return { codec, sampleRate: AUDIO_SAMPLE_RATE, numberOfChannels: 2, bitrate: AUDIO_BITRATE };
}

/** Configures a real encoder and pushes one frame through it: the only reliable support check. */
async function probeVideo(config) {
  const canvas = document.createElement('canvas');
  canvas.width = config.width;
  canvas.height = config.height;

  await new Promise((resolve, reject) => {
    const encoder = new VideoEncoder({ output: () => {}, error: reject });
    try {
      encoder.configure(config);
      const frame = new VideoFrame(canvas, { timestamp: 0, duration: Math.round(1_000_000 / FPS) });
      encoder.encode(frame, { keyFrame: true });
      frame.close();
      // close the probe encoder once it flushes: the candidate loop probes several codecs
      // per export, and each would otherwise leak an open encoder
      encoder.flush().then(() => {
        encoder.close();
        resolve();
      }, reject);
    } catch (err) {
      reject(err);
    }
  });
}

async function probeAudio(config) {
  await new Promise((resolve, reject) => {
    const encoder = new AudioEncoder({ output: () => {}, error: reject });
    try {
      encoder.configure(config);
      const frames = 1024;
      const data = new AudioData({
        format: 'f32-planar',
        sampleRate: config.sampleRate,
        numberOfFrames: frames,
        numberOfChannels: 2,
        timestamp: 0,
        data: new Float32Array(frames * 2),
      });
      encoder.encode(data);
      data.close();
      encoder.flush().then(() => {
        encoder.close();
        resolve();
      }, reject);
    } catch (err) {
      reject(err);
    }
  });
}

async function pickVideoCodec() {
  const failures = [];
  for (const candidate of VIDEO_CANDIDATES) {
    const config = videoConfig(candidate.codec);
    try {
      await probeVideo(config);
      return { ...candidate, config };
    } catch (err) {
      failures.push(`${candidate.codec}: ${err.message || err.name}`);
    }
  }
  throw new Error(`This browser can't encode video. Tried:\n${failures.join('\n')}`);
}

async function pickAudioCodec(container) {
  if (typeof AudioEncoder === 'undefined') return null;
  for (const candidate of AUDIO_CANDIDATES) {
    if (!candidate.containers.includes(container)) continue;
    const config = audioConfig(candidate.codec);
    try {
      await probeAudio(config);
      return { ...candidate, config };
    } catch {
      // fall through to the next one; a silent video beats no video
    }
  }
  return null;
}

/**
 * Renders the whole playback offline, frame by frame, and muxes it to a video.
 *
 * This depends on the frame at any moment being a pure function of elapsed time
 * (computeRevealState + drawFrame): frames are produced at exact timestamps as fast as the
 * encoder takes them, rather than screen-recorded in real time. Nothing is sampled from a
 * live canvas or a wall clock, so there are no dropped frames and no drift. Breaking that
 * invariant breaks the export, not just playback.
 *
 * Returns the extension it actually produced: the codec, and so the container, depends on
 * the browser (VIDEO_CANDIDATES).
 */
export async function exportVideo({ entries, fontSize, canvasWidth, colors, bank, sounds, onProgress }) {
  const canvas = document.createElement('canvas');
  canvas.width = EXPORT_WIDTH;
  canvas.height = EXPORT_HEIGHT;
  const ctx = canvas.getContext('2d');

  // the UI's font size is relative to the UI's canvas width, so scale it to keep the
  // proportions being previewed
  const scaledFontSize = Math.max(8, Math.round(fontSize * (EXPORT_WIDTH / canvasWidth)));

  const layout = buildLayout(ctx, entries, EXPORT_WIDTH, scaledFontSize);
  const audio = bank ? { lines: sounds, period: bank.period, dissolve: bank.dissolve } : {};
  const schedule = buildSchedule(layout, EXPORT_HEIGHT, audio);
  const particlePlan = buildParticlePlan(layout);

  const durationMs = schedule.totalDuration + TAIL_MS;
  const frameCount = Math.ceil((durationMs / 1000) * FPS);

  const video = await pickVideoCodec();
  const audioCodec = await pickAudioCodec(video.container);
  const isMp4 = video.container === 'mp4';

  const target = isMp4 ? new Mp4Target() : new WebmTarget();
  const muxer = isMp4
    ? new Mp4Muxer({
        target,
        video: { codec: video.muxer, width: EXPORT_WIDTH, height: EXPORT_HEIGHT },
        ...(audioCodec
          ? { audio: { codec: audioCodec.muxer, sampleRate: AUDIO_SAMPLE_RATE, numberOfChannels: 2 } }
          : {}),
        fastStart: 'in-memory', // playable/seekable the moment it's saved
      })
    : new WebmMuxer({
        target,
        video: { codec: video.muxer, width: EXPORT_WIDTH, height: EXPORT_HEIGHT, frameRate: FPS },
        ...(audioCodec
          ? { audio: { codec: 'A_OPUS', sampleRate: AUDIO_SAMPLE_RATE, numberOfChannels: 2 } }
          : {}),
      });

  // audio first: it's one offline mix, so its timeline can't drift from the video's
  // however long encoding takes
  if (audioCodec) await encodeAudio(muxer, schedule, durationMs, audioCodec);

  // Encoder errors arrive asynchronously on this callback. Capture and rethrow on the main
  // path: throwing from here produces an uncatchable DOMException.
  let encodeError = null;
  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => {
      encodeError = e;
    },
  });
  videoEncoder.configure(video.config);

  for (let i = 0; i < frameCount; i++) {
    if (encodeError) throw encodeError;
    const elapsed = (i * 1000) / FPS;
    const state = computeRevealState(layout, schedule, elapsed);
    drawFrame(canvas, layout, colors, state, particlePlan, EXPORT_HEIGHT);

    const frame = new VideoFrame(canvas, {
      timestamp: Math.round((i * 1_000_000) / FPS),
      duration: Math.round(1_000_000 / FPS),
    });
    videoEncoder.encode(frame, { keyFrame: i % KEYFRAME_INTERVAL === 0 });
    frame.close();

    // don't outrun the encoder, and yield so the progress bar can paint
    if (videoEncoder.encodeQueueSize > 16 || i % 10 === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    onProgress?.((i + 1) / frameCount);
  }

  await videoEncoder.flush();
  if (encodeError) throw encodeError;
  videoEncoder.close();
  muxer.finalize();

  return {
    blob: new Blob([target.buffer], { type: isMp4 ? 'video/mp4' : 'video/webm' }),
    extension: isMp4 ? 'mp4' : 'webm',
    videoCodec: video.codec,
    audioCodec: audioCodec?.codec ?? null,
  };
}

/**
 * Mixes every sound cue into one offline buffer and encodes it.
 *
 * The cues carry absolute times in the same timeline the frames are rendered from, so
 * scheduling them on an OfflineAudioContext puts every sound exactly where the picture
 * puts its matching event. A/V sync is exact by construction.
 */
async function encodeAudio(muxer, schedule, durationMs, audioCodec) {
  const cues = schedule.cues ?? [];
  if (cues.length === 0) return;

  const frames = Math.ceil((durationMs / 1000) * AUDIO_SAMPLE_RATE);
  const offline = new OfflineAudioContext(2, frames, AUDIO_SAMPLE_RATE);

  // decode each distinct clip once, however many times it's cued
  const uniqueSrcs = [...new Set(cues.map((cue) => cue.clip.src))];
  const buffers = new Map();
  await Promise.all(
    uniqueSrcs.map(async (src) => {
      const bytes = await (await fetch(src)).arrayBuffer();
      buffers.set(src, await offline.decodeAudioData(bytes));
    }),
  );

  cues.forEach((cue) => {
    const buffer = buffers.get(cue.clip.src);
    if (!buffer) return;
    const source = offline.createBufferSource();
    source.buffer = buffer;
    source.connect(offline.destination);
    source.start(cue.time / 1000);
  });

  const mix = await offline.startRendering();

  let audioError = null;
  const audioEncoder = new AudioEncoder({
    output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
    error: (e) => {
      audioError = e;
    },
  });
  audioEncoder.configure(audioCodec.config);

  const left = mix.getChannelData(0);
  const right = mix.numberOfChannels > 1 ? mix.getChannelData(1) : left;
  const CHUNK = 4800; // 100ms per AudioData

  for (let offset = 0; offset < mix.length; offset += CHUNK) {
    const count = Math.min(CHUNK, mix.length - offset);
    const planar = new Float32Array(count * 2);
    planar.set(left.subarray(offset, offset + count), 0);
    planar.set(right.subarray(offset, offset + count), count);

    const data = new AudioData({
      format: 'f32-planar',
      sampleRate: AUDIO_SAMPLE_RATE,
      numberOfFrames: count,
      numberOfChannels: 2,
      timestamp: Math.round((offset / AUDIO_SAMPLE_RATE) * 1_000_000),
      data: planar,
    });
    audioEncoder.encode(data);
    data.close();
    if (audioError) throw audioError;
  }

  await audioEncoder.flush();
  if (audioError) throw audioError;
  audioEncoder.close();
}
