// Shared locations for the IRIS comparison scripts.
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';

/** IRIS's published test videos (test/Iris.Tests/data/TestVideos), without extension. */
export const IRIS_VIDEOS = [
  '2Hz_5s', '2Hz_6s', '3Hz_6s', 'GradualRedIncrease', 'extendedFLONG', 'flashStripes', 'gray', 'intermitentEF',
];

export const cacheDir = () => process.env.IRIS_CACHE || join(tmpdir(), 'strobeguard-iris');

/** IrisApp reads paths as ANSI, so clips are copied to an ASCII-safe name; IRIS results are filed under it. */
export function safeClipName(file) {
  return basename(file, extname(file)).normalize('NFKD').replace(/[^\w.-]+/g, '_').slice(0, 80) + extname(file).toLowerCase();
}

/** Where IrisApp writes its results for a clip (frameData.json, framedata*.csv, result.json). */
export const irisResultsDir = (file) => join(cacheDir(), 'app', 'iris-1.1.0-windows-app', 'Results', safeClipName(file));
