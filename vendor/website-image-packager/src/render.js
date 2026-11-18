'use strict';

const sharp = require('sharp');
const { PackagerError } = require('./errors');

const CROP_POSITIONS = {
  attention: sharp.strategy.attention, // focuses on salient detail (contrast, saturation, skin tones)
  entropy: sharp.strategy.entropy, // keeps the busiest region
  center: 'centre',
  centre: 'centre',
};
/**
 * Cover-crops a photo to exactly width×height. The image is scaled uniformly
 * (aspect ratio preserved – never stretched) and the excess is cropped around the
 * most salient region.
 */
async function renderBanner(img, width, height, crop = 'attention') {
  const position = CROP_POSITIONS[crop] || CROP_POSITIONS.attention;
  const scale = Math.max(width / img.width, height / img.height);
  let pipeline = sharp(img.buffer, { failOn: 'error' })
    .rotate()
    .resize(width, height, { fit: 'cover', position, kernel: 'lanczos3' });
  if (scale > 1.05) {
    // Light sharpening compensates for the softness of an enlargement.
    pipeline = pipeline.sharpen({ sigma: 0.5 + Math.min(0.6, (scale - 1) * 0.8) });
  }
  const buffer = await pipeline
    .flatten({ background: '#ffffff' })
    .toColourspace('srgb')
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
  const check = await sharp(buffer).metadata();
  if (check.width !== width || check.height !== height) {
    throw new PackagerError(`internal error: rendered ${check.width}x${check.height}, expected ${width}x${height}`);
  }
  return { buffer, scale };
}

function parseColor(value) {
  const v = String(value || 'white').trim().toLowerCase();
  if (v === 'transparent' || v === 'none') return { r: 255, g: 255, b: 255, alpha: 0 };
  if (v === 'white') return { r: 255, g: 255, b: 255, alpha: 1 };
  if (v === 'black') return { r: 0, g: 0, b: 0, alpha: 1 };
  let m = /^#?([0-9a-f]{6})$/.exec(v);
  if (m) {
    const n = parseInt(m[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, alpha: 1 };
  }
  m = /^#?([0-9a-f]{3})$/.exec(v);
  if (m) {
    const [r, g, b] = m[1].split('').map((c) => parseInt(c + c, 16));
    return { r, g, b, alpha: 1 };
  }
  throw new PackagerError(`invalid --logo-bg colour "${value}" (use white, transparent or #rrggbb)`);
}

async function trimSafe(buffer) {
  try {
    const out = await sharp(buffer).trim({ threshold: 12 }).png().toBuffer({ resolveWithObject: true });
    if (out.info.width >= 4 && out.info.height >= 4) return out.data;
  } catch {
    /* uniform image or trim not applicable */
  }
  return buffer;
}

/**
 * Places a logo, trimmed of empty margins, centred on a canvas of the given size
 * (fit inside spec.boxWidth × spec.boxHeight of the canvas, aspect preserved).
 * SVG logos are rasterised at the exact resolution needed (lossless).
 */
async function renderLogo(img, spec, background = 'white') {
  const bg = parseColor(background);
  const boxW = Math.round(spec.width * spec.boxWidth);
  const boxH = Math.round(spec.height * spec.boxHeight);

  let raster;
  if (img.isSvg) {
    const need = Math.min(boxW / img.width, boxH / img.height) * 1.3;
    const density = Math.max(72, Math.min(72 * 80, Math.round(72 * need)));
    raster = await sharp(img.buffer, { density, limitInputPixels: false }).png().toBuffer();
  } else {
    raster = await sharp(img.buffer, { failOn: 'error' }).rotate().toColourspace('srgb').png().toBuffer();
  }
  raster = await trimSafe(raster);
  const meta = await sharp(raster).metadata();
  const scale = Math.min(boxW / meta.width, boxH / meta.height);
  const w = Math.max(1, Math.round(meta.width * scale));
  const h = Math.max(1, Math.round(meta.height * scale));
  const resized = await sharp(raster).resize(w, h, { fit: 'fill', kernel: 'lanczos3' }).png().toBuffer();

  const composed = await sharp({ create: { width: spec.width, height: spec.height, channels: 4, background: bg } })
    .composite([{ input: resized, gravity: 'centre' }])
    .png()
    .toBuffer();
  const buffer = bg.alpha === 1
    ? await sharp(composed).flatten({ background: bg }).removeAlpha().png({ compressionLevel: 9 }).toBuffer()
    : await sharp(composed).png({ compressionLevel: 9 }).toBuffer();

  return {
    buffer,
    // Enlargement of the original pixels (not meaningful for vector logos).
    upscale: img.isSvg ? null : scale,
    trimmedSize: `${meta.width}x${meta.height}`,
  };
}

/**
 * Gallery image as WebP. Existing WebP files are kept byte-for-byte (no
 * re-compression); other formats are converted at quality 90 at full resolution.
 */
async function toGalleryWebp(img) {
  if (img.format === 'webp' && !img.animated && (img.orientation || 1) === 1) return img.buffer;
  let pipeline = sharp(img.buffer, { failOn: 'error' }).rotate();
  if (Math.max(img.width, img.height) > 16383) pipeline = pipeline.resize(16383, 16383, { fit: 'inside' });
  return pipeline.toColourspace('srgb').webp({ quality: 90, effort: 5, smartSubsample: true }).toBuffer();
}

module.exports = { renderBanner, renderLogo, toGalleryWebp, parseColor };
