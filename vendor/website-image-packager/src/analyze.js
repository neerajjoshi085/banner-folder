'use strict';

const sharp = require('sharp');
const { sha1 } = require('./utils');
const { firstLine } = require('./errors');

const SAMPLE = 128;

/**
 * Decodes an image completely (rejecting broken/truncated files) and computes:
 *  - real (EXIF-oriented) dimensions
 *  - a 64-bit difference hash for near-duplicate detection
 *  - simple statistics used to tell photographs from logos/icons/plans.
 */
async function analyzeImage(buffer) {
  if (!buffer || buffer.length < 64) return { ok: false, reason: 'unsupported', detail: 'empty response' };

  let meta;
  try {
    meta = await sharp(buffer, { failOn: 'error' }).metadata();
  } catch (err) {
    return { ok: false, reason: 'unsupported', detail: firstLine(err) };
  }
  if (!meta.width || !meta.height) return { ok: false, reason: 'unsupported', detail: 'no dimensions' };

  const isSvg = meta.format === 'svg';
  let width = meta.width;
  let height = meta.height;
  if (meta.orientation && meta.orientation >= 5) [width, height] = [height, width];

  let data;
  try {
    // Full decode at reduced size: throws on truncated / corrupt pixel data.
    ({ data } = await sharp(buffer, { failOn: 'error' })
      .rotate()
      .resize(SAMPLE, SAMPLE, { fit: 'fill' })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true }));
  } catch (err) {
    return { ok: false, reason: 'broken', detail: firstLine(err) };
  }

  let transparent = 0;
  let opaque = 0;
  let white = 0;
  let lumSum = 0;
  const hist = new Uint32Array(256);
  const buckets = new Set();
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];
    if (a < 24) {
      transparent += 1;
      continue;
    }
    opaque += 1;
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    lumSum += lum;
    hist[Math.min(255, Math.round(lum))] += 1;
    if (r > 232 && g > 232 && b > 232) white += 1;
    buckets.add(((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4));
  }
  const total = data.length / 4;
  let entropy = 0;
  if (opaque) {
    for (const count of hist) {
      if (!count) continue;
      const p = count / opaque;
      entropy -= p * Math.log2(p);
    }
  }

  const dhash = await differenceHash(data);
  const transparentFrac = transparent / total;
  const whiteFrac = opaque ? white / opaque : 0;
  const meanLum = opaque ? lumSum / opaque : 0;
  const animated = (meta.pages || 1) > 1;

  return {
    ok: true,
    format: meta.format,
    width,
    height,
    orientation: meta.orientation || 1,
    isSvg,
    hasAlpha: !!meta.hasAlpha,
    animated,
    bytes: buffer.length,
    sha1: sha1(buffer),
    dhash,
    entropy,
    transparentFrac,
    whiteFrac,
    meanLum,
    colorBuckets: buckets.size,
    // Photograph: opaque, colourful, not mostly blank paper (floor plans, line art).
    isPhoto: !isSvg && !animated && transparentFrac < 0.03 && whiteFrac < 0.5 && entropy >= 5.2 && buckets.size >= 80,
    // Light artwork on transparency (a "white" logo meant for dark headers).
    isLight: transparentFrac > 0.1 && opaque > 0 && (whiteFrac > 0.55 || meanLum > 215),
  };
}

async function differenceHash(rgbaSample) {
  const { data } = await sharp(rgbaSample, { raw: { width: SAMPLE, height: SAMPLE, channels: 4 } })
    .flatten({ background: '#ffffff' })
    .grayscale()
    .resize(9, 8, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  let hash = 0n;
  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      const left = data[row * 9 + col];
      const right = data[row * 9 + col + 1];
      hash = (hash << 1n) | (left < right ? 1n : 0n);
    }
  }
  return hash;
}

function hammingDistance(a, b) {
  let x = a ^ b;
  let count = 0;
  while (x) {
    x &= x - 1n;
    count += 1;
  }
  return count;
}

module.exports = { analyzeImage, hammingDistance };
