'use strict';

const fs = require('fs');
const path = require('path');
const { LAYOUT, DEFAULTS, bannerFileName, galleryFileName, uniqueBannerSizes } = require('./config');
const { extractFromWebsite } = require('./extract');
const { collectImages, loadLogoOverride } = require('./download');
const { dedupeImages, rankLogos, rankPhotos, planBanners, pickGallery } = require('./select');
const { renderBanner, renderLogo, toGalleryWebp, parseColor } = require('./render');
const { checkOutputDir, prepareOutputDir } = require('./output');
const { zipPackage, zipDirectory } = require('./zip');
const { formatSummary, toJsonReport } = require('./report');
const { PackagerError } = require('./errors');
const { silentLogger, createLogger } = require('./logger');
const { folderNameFromUrl, displayUrl } = require('./utils');

function resolveOptions(o = {}) {
  if (!o.url) throw new PackagerError('A website URL is required (--url).', { code: 'E_ARGS' });
  let url = String(o.url).trim();
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) url = `https://${url}`;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new PackagerError(`Invalid URL: ${o.url}`, { code: 'E_ARGS' });
  }
  if (!/^https?:$/.test(parsed.protocol)) throw new PackagerError('Only http:// and https:// URLs are supported.', { code: 'E_ARGS' });

  const num = (value, fallback, name, min, max = Infinity) => {
    if (value === undefined || value === null || value === '') return fallback;
    const n = Number(value);
    if (!Number.isFinite(n) || n < min || n > max) throw new PackagerError(`Invalid ${name}: ${value}`, { code: 'E_ARGS' });
    return n;
  };
  const crop = o.crop || DEFAULTS.crop;
  if (!['attention', 'entropy', 'center', 'centre'].includes(crop)) {
    throw new PackagerError(`Invalid crop strategy "${crop}" (attention, entropy or center).`, { code: 'E_ARGS' });
  }
  const logoBackground = o.logoBackground || DEFAULTS.logoBackground;
  parseColor(logoBackground); // validates

  return {
    url: parsed.href,
    outDir: path.resolve(o.outDir || folderNameFromUrl(parsed.href)),
    imagesPerSize: Math.round(num(o.imagesPerSize, DEFAULTS.imagesPerSize, 'images per size', 1, 50)),
    maxUpscale: num(o.maxUpscale, DEFAULTS.maxUpscale, 'max upscale', 1, 10000),
    crop,
    logo: o.logo || null,
    logoBackground,
    gallery: o.gallery !== undefined ? !!o.gallery : DEFAULTS.gallery,
    includeHero: !!o.includeHero,
    maxGallery: Math.round(num(o.maxGallery, DEFAULTS.maxGallery, 'max gallery', 0, 500)),
    minGallerySize: Math.round(num(o.minGallerySize, DEFAULTS.minGallerySize, 'min gallery size', 100, 10000)),
    mobilePass: o.mobilePass !== undefined ? !!o.mobilePass : DEFAULTS.mobilePass,
    timeout: Math.round(num(o.timeout, DEFAULTS.timeout, 'timeout', 5000)),
    requestTimeout: Math.round(num(o.requestTimeout, DEFAULTS.requestTimeout, 'request timeout', 1000)),
    scrollMs: Math.round(num(o.scrollMs, DEFAULTS.scrollMs, 'scroll time', 0)),
    concurrency: Math.round(num(o.concurrency, DEFAULTS.concurrency, 'concurrency', 1, 32)),
    maxCandidates: Math.round(num(o.maxCandidates, DEFAULTS.maxCandidates, 'max candidates', 1)),
    maxImageBytes: DEFAULTS.maxImageBytes,
    browser: o.browser || undefined,
    headed: !!o.headed,
    force: !!o.force,
    logger: o.logger || silentLogger,
  };
}

const isWhiteish = (c) => c.alpha === 1 && c.r > 200 && c.g > 200 && c.b > 200;

/**
 * Extracts images from a website and writes the banner package.
 * Resolves with a result object (see README → "Programmatic use").
 */
async function packageWebsite(options) {
  const opts = resolveOptions(options);
  const log = opts.logger;
  const started = Date.now();
  const outDir = opts.outDir;

  // Fail fast – before opening the browser – if the output folder cannot be used.
  checkOutputDir(outDir, { force: opts.force, layout: LAYOUT });

  const result = {
    url: opts.url,
    finalUrl: null,
    pageTitle: '',
    outDir,
    complete: false,
    galleryEnabled: opts.gallery,
    settings: {
      imagesPerSize: opts.imagesPerSize,
      maxUpscale: opts.maxUpscale,
      crop: opts.crop,
      minGallerySize: opts.minGallerySize,
      includeHero: opts.includeHero,
    },
    logos: [],
    logoAlternatives: [],
    banners: [],
    gallery: [],
    missing: [],
    warnings: [],
    stats: {},
  };

  /* 1. Extract ------------------------------------------------------------ */
  log.step(`Opening ${opts.url} in headless Chromium${opts.mobilePass ? ' (desktop + mobile)' : ''}`);
  const site = await extractFromWebsite(opts.url, opts, log);
  result.finalUrl = site.finalUrl;
  result.pageTitle = site.title;
  log.info(`  ${site.candidates.length} image references found`);

  /* 2. Download, validate, de-duplicate ---------------------------------- */
  log.step('Downloading and validating images');
  const { images: valid, stats } = await collectImages(site, opts, log);
  const { images, removed } = dedupeImages(valid);
  result.stats = { ...stats, duplicatesRemoved: removed, unique: images.length };
  log.info(`  ${valid.length} valid images, ${removed} duplicates removed`);
  if (!images.length) {
    throw new PackagerError(
      `No usable images were found on ${site.finalUrl}` +
        `${site.status >= 400 ? ` (the page answered HTTP ${site.status})` : ''}.\n` +
        'The site may block automated browsers – try --headed, or --browser chrome.',
      { code: 'E_NO_IMAGES' },
    );
  }

  /* 3. Select ------------------------------------------------------------ */
  const logoRanking = rankLogos(images);
  let logo = null;
  if (opts.logo) {
    log.step(`Loading logo from ${opts.logo}`);
    logo = await loadLogoOverride(opts.logo, site, opts);
  } else if (logoRanking.length) {
    logo = logoRanking[0].img;
  }
  result.logoAlternatives = logoRanking
    .filter((x) => x.img !== logo)
    .slice(0, 5)
    .map((x) => displayUrl(x.img.url));

  const logoKeys = new Set(logoRanking.map((x) => x.img.key));
  const { photos, heroExcluded } = rankPhotos(images, logoKeys, { includeHero: opts.includeHero });
  const sizes = uniqueBannerSizes(LAYOUT);
  const plan = planBanners(photos, sizes, { perSize: opts.imagesPerSize, maxUpscale: opts.maxUpscale });
  const galleryPicks = opts.gallery ? pickGallery(photos, { ...opts, minFill: opts.imagesPerSize }) : [];
  const familyCount = new Set(photos.map((p) => p.family)).size;
  const galleryFamilies = new Set(photos.filter((p) => p.tier === 1).map((p) => p.family)).size;
  result.stats.photos = photos.length;
  result.stats.gallerySectionPhotos = galleryFamilies;
  result.stats.otherSectionPhotos = familyCount - galleryFamilies;
  result.stats.heroExcluded = heroExcluded.length;
  result.heroExcluded = heroExcluded.map((u) => displayUrl(u));
  result.stats.graphics = images.length - photos.length - heroExcluded.length;
  result.stats.lowResolution = photos.filter((p) => Math.max(p.width, p.height) < opts.minGallerySize).length;
  log.info(
    `  usable photos: ${galleryFamilies} from the gallery section, ${familyCount - galleryFamilies} from other sections` +
      `${opts.includeHero ? '' : ` (${heroExcluded.length} hero image(s) excluded)`}; ${logoRanking.length} logo candidates`,
  );

  /* 4. Write ------------------------------------------------------------- */
  prepareOutputDir(outDir, { force: opts.force, layout: LAYOUT, gallery: opts.gallery });

  // Logos
  if (logo) {
    log.step('Creating logos');
    let background = opts.logoBackground;
    if (logo.isLight && isWhiteish(parseColor(background))) {
      background = '#111111';
      result.warnings.push(
        'The only logo found is light/white artwork (made for a dark header), so it was placed on a dark #111111 ' +
          'background to stay visible. Use --logo to supply a dark version for a white background.',
      );
    }
    let upscaleMax = 0;
    for (const spec of LAYOUT.logos) {
      const rendered = await renderLogo(logo, spec, background);
      await fs.promises.writeFile(path.join(outDir, spec.file), rendered.buffer);
      upscaleMax = Math.max(upscaleMax, rendered.upscale || 0);
      result.logos.push({
        file: spec.file,
        width: spec.width,
        height: spec.height,
        format: spec.label,
        source: logo.url,
        sourceType: logo.isSvg ? 'vector (SVG)' : 'raster',
        sourceSize: `${logo.width}x${logo.height}`,
        upscale: rendered.upscale,
        background,
      });
    }
    for (const l of result.logos) l.upscaleMax = upscaleMax;
    if (!logo.isSvg && upscaleMax > 4) {
      result.warnings.push(
        `The logo on the website is only ${logo.width}x${logo.height}px, so it was enlarged ${upscaleMax.toFixed(1)}x ` +
          'to fill the 1200px canvas and may look soft. Supply a larger PNG or an SVG with --logo for a sharper result.',
      );
    }
  } else {
    result.missing.push(
      'logo.png and logo-1.png: no logo was found on the page (checked header/nav images, inline SVGs, CSS ' +
        'backgrounds, "logo" file names/classes and structured data). Supply one with --logo <file-or-url>.',
    );
  }

  // Banners
  log.step('Rendering banner sizes');
  const rendered = new Map();
  for (const size of sizes) {
    const picks = plan.get(size.key) || [];
    const entries = [];
    for (let i = 0; i < picks.length; i += 1) {
      const pick = picks[i];
      const file = bannerFileName(i);
      const { buffer, scale } = await renderBanner(pick.img, size.width, size.height, opts.crop);
      for (const folder of size.folders) await fs.promises.writeFile(path.join(outDir, folder, file), buffer);
      entries.push({
        file,
        source: pick.img.url,
        section: pick.tier === 1 ? 'gallery' : 'other',
        sourceSize: `${pick.img.width}x${pick.img.height}`,
        scale: Number(scale.toFixed(3)),
        keptFraction: Number(pick.kept.toFixed(3)),
      });
    }
    rendered.set(size.key, { size, entries });
    log.info(`  ${size.key}: ${entries.length}/${opts.imagesPerSize}`);
  }
  for (const campaign of LAYOUT.campaigns) {
    for (const s of campaign.sizes) {
      const key = `${s.width}x${s.height}`;
      const { entries } = rendered.get(key);
      const folder = `${campaign.name}/${key}`;
      result.banners.push({ folder, width: s.width, height: s.height, expected: opts.imagesPerSize, files: entries });
      if (entries.length < opts.imagesPerSize) {
        const minW = Math.ceil(s.width / opts.maxUpscale);
        const minH = Math.ceil(s.height / opts.maxUpscale);
        const n = entries.length;
        const heroNote = opts.includeHero || !heroExcluded.length ? '' : ', hero section excluded';
        result.missing.push(
          familyCount === 0
            ? `${folder}: 0 of ${opts.imagesPerSize} images. No usable photographs were found on the site${heroNote}.`
            : `${folder}: ${n} of ${opts.imagesPerSize} images. ${n === 0 ? 'None' : `Only ${n}`} of the site's ` +
                `${familyCount} distinct usable photo(s) (gallery + other sections${heroNote}) can be cropped to ` +
                `${s.width}x${s.height} without enlarging more than ${opts.maxUpscale}x ` +
                `(a source needs at least ${minW}x${minH}px).`,
        );
      }
    }
  }

  // Gallery
  if (opts.gallery) {
    log.step('Saving gallery images');
    for (let i = 0; i < galleryPicks.length; i += 1) {
      const img = galleryPicks[i];
      const file = galleryFileName(i);
      const buffer = await toGalleryWebp(img);
      await fs.promises.writeFile(path.join(outDir, LAYOUT.galleryDir, file), buffer);
      result.gallery.push({
        file,
        source: img.url,
        section: img.tier === 1 ? 'gallery' : 'other',
        size: `${img.width}x${img.height}`,
        bytes: buffer.length,
      });
    }
    if (!galleryPicks.length) {
      result.missing.push(
        `gallery/: no photos with a longest side of at least ${opts.minGallerySize}px were found ` +
          '(lower the limit with --min-gallery-size).',
      );
    }
  }

  result.complete = result.missing.length === 0;
  result.durationMs = Date.now() - started;
  return result;
}

module.exports = {
  packageWebsite,
  zipPackage,
  zipDirectory,
  formatSummary,
  toJsonReport,
  createLogger,
  PackagerError,
  LAYOUT,
  DEFAULTS,
};
