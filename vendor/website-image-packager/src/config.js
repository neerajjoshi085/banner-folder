'use strict';

/**
 * Output layout. Reproduces the reference banner package exactly:
 *
 *   <project>/
 *   ├── logo.png              1200×300  (4:1 landscape logo on a white canvas)
 *   ├── logo-1.png            1200×1200 (1:1 square logo on a white canvas)
 *   ├── gallery/              gallery-01.webp, gallery-02.webp, …
 *   ├── Discovery/
 *   │   ├── 1200x1200/        image.png, image-1.png, image-2.png, image-3.png
 *   │   ├── 1200x628/         (same four names)
 *   │   └── 960x1200/
 *   └── Remarketing/
 *       ├── 1200x1200/        (byte-identical to Discovery/1200x1200)
 *       ├── 1200x628/         (byte-identical to Discovery/1200x628)
 *       └── 900x1600/
 *
 * boxWidth / boxHeight = share of the canvas the logo may occupy (measured from
 * the reference logos, where the artwork spans ~62–66% of the width).
 */
const LAYOUT = Object.freeze({
  logos: Object.freeze([
    Object.freeze({ file: 'logo.png', width: 1200, height: 300, boxWidth: 0.66, boxHeight: 0.74, label: 'landscape 4:1' }),
    Object.freeze({ file: 'logo-1.png', width: 1200, height: 1200, boxWidth: 0.66, boxHeight: 0.66, label: 'square 1:1' }),
  ]),
  campaigns: Object.freeze([
    Object.freeze({
      name: 'Discovery',
      sizes: Object.freeze([
        Object.freeze({ width: 1200, height: 1200 }),
        Object.freeze({ width: 1200, height: 628 }),
        Object.freeze({ width: 960, height: 1200 }),
      ]),
    }),
    Object.freeze({
      name: 'Remarketing',
      sizes: Object.freeze([
        Object.freeze({ width: 1200, height: 1200 }),
        Object.freeze({ width: 1200, height: 628 }),
        Object.freeze({ width: 900, height: 1600 }),
      ]),
    }),
  ]),
  imagesPerSize: 4,
  galleryDir: 'gallery',
});

const DEFAULTS = Object.freeze({
  imagesPerSize: LAYOUT.imagesPerSize,
  maxUpscale: 1.5, // never enlarge a source crop by more than 1.5× to reach a banner size
  crop: 'attention', // sharp smart-crop strategy: attention | entropy | center
  logoBackground: 'white',
  gallery: true,
  maxGallery: 30,
  minGallerySize: 800, // longest side, px; shortest side must be ≥ 56% of this
  mobilePass: true,
  timeout: 60000,
  requestTimeout: 30000,
  scrollMs: 25000,
  concurrency: 6,
  maxCandidates: 600,
  maxImageBytes: 40 * 1024 * 1024,
});

function sizeKey(size) {
  return `${size.width}x${size.height}`;
}

/** image.png, image-1.png, image-2.png, … (reference naming). */
function bannerFileName(index) {
  return index === 0 ? 'image.png' : `image-${index}.png`;
}

/** gallery-01.webp, gallery-02.webp, … */
function galleryFileName(index) {
  return `gallery-${String(index + 1).padStart(2, '0')}.webp`;
}

/**
 * Banner sizes de-duplicated across campaigns, so a size shared by Discovery and
 * Remarketing is rendered once and copied (identical files, like the reference).
 */
function uniqueBannerSizes(layout = LAYOUT) {
  const map = new Map();
  for (const campaign of layout.campaigns) {
    for (const size of campaign.sizes) {
      const key = sizeKey(size);
      if (!map.has(key)) map.set(key, { width: size.width, height: size.height, key, folders: [] });
      map.get(key).folders.push(`${campaign.name}/${key}`);
    }
  }
  return [...map.values()];
}

module.exports = { LAYOUT, DEFAULTS, sizeKey, bannerFileName, galleryFileName, uniqueBannerSizes };
