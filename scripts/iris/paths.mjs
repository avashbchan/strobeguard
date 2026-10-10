// Shared locations for the IRIS comparison scripts.
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** IRIS's published test videos (test/Iris.Tests/data/TestVideos), without extension. */
export const IRIS_VIDEOS = [
  '2Hz_5s', '2Hz_6s', '3Hz_6s', 'GradualRedIncrease', 'extendedFLONG', 'flashStripes', 'gray', 'intermitentEF',
];

export const cacheDir = () => process.env.IRIS_CACHE || join(tmpdir(), 'strobeguard-iris');
