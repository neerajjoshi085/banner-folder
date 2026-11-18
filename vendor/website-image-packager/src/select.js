'use strict';

const { hammingDistance } = require('./analyze');
const { tokens, pathText } = require('./utils');

const hasAny = (set, words) => words.some((w) => set.has(w));

/* ------------------------------------------------------------------ duplicates */

function pixelQuality(img) {
  return img.isSvg ? Number.MAX_SAFE_INTEGER : img.width * img.height;
}

function isDuplicate(a, b) {
  if (a.sha1 === b.sha1) return true;
  if (a.dhash === 0n || b.dhash === 0n) return false; // flat images carry no signal
  const arA = a.width / a.height;
  const arB = b.width / b.height;
  if (Math.abs(arA - arB) / Math.max(arA, arB) > 0.06) return false;
  return hammingDistance(a.dhash, b.dhash) <= 5;
}

function mergeInto(keep, other) {
  for (const s of other.sources) keep.sources.add(s);
  keep.aliases.push(other.url);
  keep.order = Math.min(keep.order, other.order);
  keep.inHeader = keep.inHeader || other.inHeader;
  keep.inFooter = keep.inFooter || other.inFooter;
  keep.inGallery = keep.inGallery || other.inGallery;
  keep.inHero = keep.inHero || other.inHero;
  keep.homeLink = keep.homeLink || other.homeLink;
  keep.visible = keep.visible || other.visible;
  keep.minY = Math.min(keep.minY, other.minY);
  keep.maxArea = Math.max(keep.maxArea, other.maxArea);
  if (!keep.selfText.includes(other.selfText)) keep.selfText += ` ${other.selfText}`;
  if (!keep.altText.includes(other.altText)) keep.altText += ` ${other.altText}`;
  if (!keep.classText.includes(other.classText)) keep.classText += ` ${other.classText}`;
  if (!keep.ctxText.includes(other.ctxText)) keep.ctxText += ` ${other.ctxText}`;
  if (!keep.sectionText.includes(other.sectionText)) keep.sectionText += ` ${other.sectionText}`;
}

/**
 * Removes exact (same bytes) and visual (same picture at another resolution /
 * compression) duplicates, keeping the highest-resolution copy.
 */
function dedupeImages(images) {
  const sorted = [...images].sort((a, b) => pixelQuality(b) - pixelQuality(a) || a.order - b.order);
  const kept = [];
  let removed = 0;
  for (const img of sorted) {
    const dup = kept.find((k) => isDuplicate(k, img));
    if (dup) {
      mergeInto(dup, img);
      removed += 1;
    } else {
      kept.push({ ...img, sources: new Set(img.sources), aliases: [img.url] });
    }
  }
  kept.sort((a, b) => a.order - b.order);
  return { images: kept, removed };
}

/* ------------------------------------------------------------------ logos */

const LOGO_STRONG_NEG = [
  'whatsapp', 'wa', 'phone', 'call', 'mail', 'email', 'facebook', 'fb', 'instagram', 'insta', 'twitter',
  'youtube', 'linkedin', 'pinterest', 'telegram', 'qr', 'qrcode', 'rera', 'payment', 'visa', 'mastercard',
  'paypal', 'playstore', 'appstore', 'arrow', 'close', 'menu', 'hamburger', 'loader', 'spinner', 'loading',
  'flag', 'avatar', 'user', 'star', 'rating', 'map', 'award', 'awards', 'certificate', 'badge', 'favicon',
];
const LOGO_WEAK_NEG = [
  'icon', 'icons', 'banner', 'hero', 'slider', 'gallery', 'amenity', 'amenities', 'floor', 'plan', 'plans',
  'bg', 'background', 'pattern',
];
const LOGO_CTX_NEG = /(bank|lender|loan|clients?|sponsor|award|testimonial|associat|media-|press|featured|approved)/;

function scoreLogo(img) {
  if (img.animated) return -Infinity;
  const self = img.selfText;
  const t = new Set(tokens(self));
  const hasLogoWord = /logo|brand|wordmark/.test(self);
  let s = 0;
  if (hasLogoWord) s += 45;
  else if (/logo|brand/.test(img.ctxText)) s += 15;
  if (img.inHeader) s += 25;
  if (img.homeLink) s += 15;
  if (img.visible && img.minY < 220) s += 10;
  if (img.sources.has('jsonld-logo') || img.sources.has('meta-logo')) s += 30;
  if (img.isSvg) s += 12;
  if (img.transparentFrac > 0.05) s += 5;
  if (img.inFooter && !img.inHeader) s -= 5;
  if ([...img.sources].every((x) => x === 'icon')) s -= 40;
  if (hasAny(t, LOGO_STRONG_NEG)) s -= 60;
  if (!hasLogoWord && hasAny(t, LOGO_WEAK_NEG)) s -= 30;
  if (!img.inHeader && LOGO_CTX_NEG.test(img.ctxText)) s -= 30;
  if (img.isPhoto) s -= 50;
  if (img.isLight) s -= 50;
  const ar = img.width / img.height;
  if (ar < 0.4 || ar > 12) s -= 40;
  const effectiveWidth = img.isSvg ? 4000 : img.width;
  s += Math.min(15, Math.max(0, Math.log2(effectiveWidth / 100) * 4));
  return s;
}

const LOGO_THRESHOLD = 40;

function isHomeLinkedHeaderBrand(img) {
  return img.inHeader && img.homeLink && img.visible && img.width >= 40 && img.height >= 14 && !img.isPhoto && !img.animated;
}

/** Ranked logo candidates (best first), visually distinct from each other. */
function rankLogos(images) {
  return images
    .map((img) => ({ img, score: scoreLogo(img) }))
    .filter((x) => x.score >= LOGO_THRESHOLD || isHomeLinkedHeaderBrand(x.img))
    .sort((a, b) => b.score - a.score || a.img.order - b.img.order);
}

function finaliseOverride(img) {
  return {
    ...img,
    sources: new Set(['override']),
    aliases: [img.url],
    selfText: '',
    altText: '',
    classText: '',
    ctxText: '',
    sectionText: '',
    pathText: '',
    family: 'override',
    order: -1,
    inHeader: false,
    inFooter: false,
    inGallery: false,
    inHero: false,
    homeLink: false,
    visible: false,
    minY: Infinity,
    maxArea: 0,
  };
}

/* ------------------------------------------------------------------ photos */

// Words in the image's file name / folders that rule it out as a banner or gallery photo.
const PATH_BLOCK = [
  'floor', 'floorplan', 'floorplans', 'plan', 'plans', 'masterplan', 'siteplan', 'unitplan', 'layout',
  'map', 'maps', 'location', 'locationmap', 'brochure', 'qr', 'qrcode', 'icon', 'icons', 'logo', 'logos',
  'favicon', 'pattern', 'texture', 'shape', 'shapes', 'overlay', 'sprite', 'placeholder', 'loader',
  'loading', 'spinner', 'whatsapp', 'award', 'awards', 'certificate', 'rera', 'signature', 'avatar',
  'testimonial', 'testimonials', 'price', 'pricelist', 'pricing', 'offer', 'btn', 'button', 'arrow',
  'bullet', 'check', 'tick', 'badge', 'stamp', 'seal', 'divider', 'separator', 'watermark', 'dummy',
  'blank', 'spacer', 'pixel', 'qrimg', 'cta', 'popup', 'thankyou',
];
// Narrower lists for class/id names and free-text alt attributes.
const CLASS_BLOCK = [
  'logo', 'logos', 'icon', 'icons', 'floorplan', 'floorplans', 'masterplan', 'siteplan', 'unitplan', 'map',
  'qr', 'qrcode', 'pattern', 'overlay', 'sprite', 'avatar', 'testimonial', 'testimonials', 'loader',
  'placeholder', 'whatsapp', 'award', 'awards', 'rera',
];
const ALT_BLOCK = ['logo', 'icon', 'qr', 'qrcode', 'floorplan', 'floorplans', 'masterplan', 'siteplan', 'brochure', 'avatar'];
const ALT_PHRASE_BLOCK = /(floor|master|site|unit|typical)\s*-?\s*plans?\b|location\s*map|price\s*list|route\s*map/;
const PHOTO_CTX_BLOCK = /(^|[^a-z])(floor-?plans?|master-?plans?|site-?plans?|unit-?plans?|price-?list|pricing|brochure|testimonials?|location-?map|map)([^a-z]|$)/;
// Used only for images with no page context (seen on the network / in meta tags).
const HERO_PATH_WORDS = ['banner', 'banners', 'hero', 'slider', 'slide', 'masthead', 'cover'];
const DOMLESS_SOURCES = new Set(['network', 'og-image', 'jsonld-image', 'icon', 'meta-logo', 'jsonld-logo']);
const SUBJECT_WORDS = [
  'gallery', 'project', 'exterior', 'interior', 'elevation', 'view', 'aerial', 'render', 'tower', 'towers',
  'lobby', 'clubhouse', 'pool', 'amenities', 'amenity', 'living', 'bedroom', 'facade', 'entrance', 'garden',
];

const CSS_SOURCES = new Set(['css-bg', 'css-rule']);

function isUsablePhoto(img, excludedKeys) {
  if (!img.isPhoto || excludedKeys.has(img.key)) return false;
  if (hasAny(new Set(tokens(img.pathText || pathText(img.url))), PATH_BLOCK)) return false;
  if (hasAny(new Set(tokens(img.classText)), CLASS_BLOCK)) return false;
  if (hasAny(new Set(tokens(img.altText)), ALT_BLOCK) || ALT_PHRASE_BLOCK.test(img.altText)) return false;
  if (PHOTO_CTX_BLOCK.test(img.sectionText)) return false;
  // Decorative footer backgrounds (often generic stock photos) are not project imagery.
  if (tokens(img.pathText).includes('footer')) return false;
  const onlyCss = [...img.sources].every((s) => CSS_SOURCES.has(s));
  if (onlyCss && img.inFooter && !img.inHero && !img.inGallery) return false;
  return true;
}

function scorePhoto(img) {
  const t = new Set(tokens(img.selfText));
  const own = new Set(tokens(img.pathText));
  let s = 35 * Math.min(1, (img.width * img.height) / (1920 * 1080));
  if (hasAny(t, SUBJECT_WORDS)) s += 8;
  if (hasAny(own, ['thumb', 'thumbs', 'thumbnail', 'small', 'sm', 'xs'])) s -= 12;
  if (img.inFooter && !img.inGallery) s -= 8;
  s += Math.max(-10, Math.min(8, (img.entropy - 6.5) * 6));
  return s;
}

function isHeroImage(img) {
  if (img.inHero) return true;
  const domless = [...img.sources].every((s) => DOMLESS_SOURCES.has(s));
  return domless && hasAny(new Set(tokens(img.pathText)), HERO_PATH_WORDS);
}

/**
 * Photographs suitable for banners/gallery, each tagged with a source tier:
 *   tier 1 = from the website's gallery section, tier 2 = from any other section.
 * Hero-section images – and every size/device variant of them – are excluded
 * unless includeHero is set. Sorted tier first, then quality.
 */
function rankPhotos(images, excludedKeys, { includeHero = false } = {}) {
  const usable = images.filter((img) => isUsablePhoto(img, excludedKeys));
  const heroFamilies = new Set(usable.filter(isHeroImage).map((img) => img.family));
  const photos = [];
  const heroExcluded = [];
  for (const img of usable) {
    const hero = heroFamilies.has(img.family);
    if (hero && !includeHero) {
      heroExcluded.push(img.url);
      continue;
    }
    photos.push({ ...img, isHero: hero, tier: img.inGallery && !hero ? 1 : 2, score: scorePhoto(img) });
  }
  photos.sort((a, b) => a.tier - b.tier || b.score - a.score || a.order - b.order);
  return { photos, heroExcluded };
}

/** Share of the source that survives a cover-crop to the target aspect ratio. */
function keptFraction(img, width, height) {
  const src = img.width / img.height;
  const dst = width / height;
  return Math.min(src / dst, dst / src);
}

/**
 * Chooses `perSize` distinct source photos for every banner size.
 * - gallery-section photos first; other sections only fill the remaining slots
 * - one picture per "family" (desktop/mobile/size variants of the same scene)
 * - the family member needing the least cropping for that aspect ratio is used
 * - a source is only used if reaching the target needs ≤ maxUpscale enlargement
 */
function planBanners(photos, sizes, { perSize, maxUpscale }) {
  const families = new Map();
  for (const p of photos) {
    if (!families.has(p.family)) families.set(p.family, []);
    families.get(p.family).push(p);
  }
  const plan = new Map();
  for (const size of sizes) {
    const options = [];
    for (const members of families.values()) {
      let best = null;
      for (const img of members) {
        const scale = Math.max(size.width / img.width, size.height / img.height);
        if (scale > maxUpscale + 1e-9) continue;
        const kept = keptFraction(img, size.width, size.height);
        if (!best || kept > best.kept + 0.02 || (Math.abs(kept - best.kept) <= 0.02 && scale < best.scale)) {
          best = { img, scale, kept };
        }
      }
      if (best) {
        const familyScore = Math.max(...members.map((m) => m.score));
        const order = Math.min(...members.map((m) => m.order));
        const tier = Math.min(...members.map((m) => m.tier || 2));
        options.push({ ...best, tier, rank: familyScore + 15 * best.kept, order });
      }
    }
    options.sort((a, b) => a.tier - b.tier || b.rank - a.rank || a.order - b.order);
    plan.set(size.key, options.slice(0, perSize));
  }
  return plan;
}

/**
 * Gallery folder: the website's gallery-section photos (in page order). Only if there
 * are fewer than `minFill` of them is it topped up with the best photos from other
 * (non-hero) sections. One photo per family (largest member), minimum resolution applies.
 */
function pickGallery(photos, { maxGallery, minGallerySize, minFill = 4 }) {
  const minShort = Math.round(minGallerySize * 0.56);
  const byFamily = new Map();
  for (const p of photos) {
    const long = Math.max(p.width, p.height);
    const short = Math.min(p.width, p.height);
    if (long < minGallerySize || short < minShort) continue;
    const current = byFamily.get(p.family);
    if (!current) {
      byFamily.set(p.family, p);
    } else {
      const bigger = p.width * p.height > current.width * current.height ? p : current;
      byFamily.set(p.family, { ...bigger, tier: Math.min(p.tier || 2, current.tier || 2), order: Math.min(p.order, current.order) });
    }
  }
  const eligible = [...byFamily.values()];
  const fromGallery = eligible.filter((p) => p.tier === 1).sort((a, b) => a.order - b.order);
  const others = eligible.filter((p) => p.tier !== 1).sort((a, b) => b.score - a.score || a.order - b.order);
  const topUp = Math.max(0, minFill - fromGallery.length);
  return [...fromGallery, ...others.slice(0, topUp)].slice(0, maxGallery);
}

module.exports = {
  dedupeImages,
  rankLogos,
  scoreLogo,
  finaliseOverride,
  rankPhotos,
  planBanners,
  pickGallery,
  keptFraction,
};
