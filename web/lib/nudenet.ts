'use client';
// In-browser NudeNet (github.com/vladmandic/nudenet, MIT) on TensorFlow.js + WebGL.
// Runs on the streamer's own device → zero network latency, video is blocked
// before it ever reaches viewers. Model (~70 MB) is cached in IndexedDB after
// the first load, so later visits start instantly and offline.
import * as tf from '@tensorflow/tfjs';

const MODEL_URL = '/models/nudenet/model.json';
const IDB_KEY = 'indexeddb://nudenet-default-f16-v1';

export const LABELS = [
  'exposed anus', 'exposed armpits', 'belly', 'exposed belly', 'buttocks', 'exposed buttocks',
  'female face', 'male face', 'feet', 'exposed feet', 'breast', 'exposed breast',
  'vagina', 'exposed vagina', 'male breast', 'exposed male breast',
];
const NUDE = new Set([0, 5, 11, 12, 13]);
const SEXY = new Set([3, 4, 10, 15]); // belly, buttocks, breast (covered), male breast

export type Detection = { label: string; score: number; box: [number, number, number, number] };
export type NsfwResult = { verdict: 'nude' | 'suggestive' | 'safe'; score: number; detections: Detection[]; ms: number; backend: string };

let modelPromise: Promise<tf.GraphModel> | null = null;
export let loadedFrom: 'cache' | 'network' | null = null;

export function loadNudeNet(onProgress?: (p: number) => void): Promise<tf.GraphModel> {
  if (modelPromise) return modelPromise;
  modelPromise = (async () => {
    try { await tf.setBackend('webgl'); } catch { await tf.setBackend('cpu'); }
    await tf.ready();
    let model: tf.GraphModel;
    try {
      model = await tf.loadGraphModel(IDB_KEY);
      loadedFrom = 'cache';
      onProgress?.(1);
    } catch {
      model = await tf.loadGraphModel(MODEL_URL, { onProgress });
      loadedFrom = 'network';
      model.save(IDB_KEY).catch(() => {}); // cache for next time
    }
    // warm-up so the first real frame is fast (shader compilation)
    const warm = tf.zeros([1, 256, 256, 3]);
    const out = (await model.executeAsync(warm, ['output1', 'output2', 'output3'])) as tf.Tensor[];
    tf.dispose([warm, ...out]);
    return model;
  })();
  modelPromise.catch(() => { modelPromise = null; });
  return modelPromise;
}

type Source = HTMLVideoElement | HTMLImageElement | HTMLCanvasElement | ImageBitmap;

export async function detectNsfw(src: Source, opts: { size?: number; minScore?: number } = {}): Promise<NsfwResult> {
  const size = opts.size ?? 384; // 384px is 3x-4x faster than 720p on browser GPUs/CPUs
  const minScore = opts.minScore ?? 0.35;
  const model = await loadNudeNet();
  const t0 = performance.now();

  const w = 'videoWidth' in src ? src.videoWidth : (src as HTMLImageElement).naturalWidth || src.width;
  const h = 'videoHeight' in src ? src.videoHeight : (src as HTMLImageElement).naturalHeight || src.height;
  if (!w || !h) return { verdict: 'safe', score: 0, detections: [], ms: 0, backend: tf.getBackend() };
  const scale = Math.min(1, size / Math.max(w, h));

  const input = tf.tidy(() => {
    const img = tf.browser.fromPixels(src as never);
    const resized = scale < 1 ? tf.image.resizeBilinear(img, [Math.round(h * scale), Math.round(w * scale)]) : img;
    return tf.expandDims(tf.cast(resized, 'float32'), 0);
  });
  const [boxesT, scoresT, classesT] = (await model.executeAsync(input, ['output1', 'output2', 'output3'])) as tf.Tensor[];
  const boxes2d = tf.squeeze(boxesT, [0]) as tf.Tensor2D;
  const [scores, classes, nmsT] = await Promise.all([
    scoresT.data() as Promise<Float32Array>,
    classesT.data() as Promise<Float32Array>,
    tf.image.nonMaxSuppressionAsync(boxes2d, scoresT.flatten() as tf.Tensor1D, 20, 0.5, minScore),
  ]);
  const [keep, boxes] = await Promise.all([
    nmsT.data(),
    boxes2d.array() as Promise<number[][]>,
  ]);
  tf.dispose([input, boxesT, scoresT, classesT, boxes2d, nmsT]);

  const detections: Detection[] = [];
  let nude = 0, sexy = 0;
  for (const idx of keep) { // upstream demo used the loop index here; we use the kept index
    const cls = classes[idx];
    const score = scores[idx];
    const b = boxes[idx];
    detections.push({ label: LABELS[cls] ?? String(cls), score: +score.toFixed(3), box: [b[0] / scale, b[1] / scale, (b[2] - b[0]) / scale, (b[3] - b[1]) / scale] });
    if (NUDE.has(cls)) nude = Math.max(nude, score);
    else if (SEXY.has(cls)) sexy = Math.max(sexy, score);
  }
  const verdict = nude ? 'nude' : sexy ? 'suggestive' : 'safe';
  return { verdict, score: +(nude || sexy).toFixed(3), detections, ms: Math.round(performance.now() - t0), backend: tf.getBackend() };
}
