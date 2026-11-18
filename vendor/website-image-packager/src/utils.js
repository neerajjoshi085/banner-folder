'use strict';

const crypto = require('crypto');

function sha1(buffer) {
  return crypto.createHash('sha1').update(buffer).digest('hex');
}

/** Absolute URL without the #fragment (data: URIs are returned unchanged). */
function normalizeUrl(url) {
  if (!url || url.startsWith('data:')) return url;
  try {
    const u = new URL(url);
    u.hash = '';
    return u.href;
  } catch {
    return url;
  }
}

/**
 * Path of the real image behind a URL, unwrapping image proxies such as
 * Next.js `/_next/image?url=/img/hero.jpg&w=3840`.
 */
function effectivePath(url) {
  if (!url || url.startsWith('data:')) return '';
  try {
    const u = new URL(url);
    for (const key of ['url', 'src', 'image', 'img', 'file']) {
      const v = u.searchParams.get(key);
      if (v && /\.(jpe?g|png|webp|avif|gif|svg|bmp|tiff?)(\?|$)/i.test(v)) {
        try {
          return decodeURIComponent(new URL(v, u.origin).pathname);
        } catch {
          return v;
        }
      }
    }
    return decodeURIComponent(u.pathname);
  } catch {
    return '';
  }
}

function fileStem(url) {
  const base = effectivePath(url).split('/').filter(Boolean).pop() || '';
  return base.replace(/\.[a-z0-9]{2,5}$/i, '');
}

/** Last `count` path segments (directories + file stem), for keyword matching. */
function pathText(url, count = 3) {
  const parts = effectivePath(url).split('/').filter(Boolean);
  if (parts.length) parts[parts.length - 1] = parts[parts.length - 1].replace(/\.[a-z0-9]{2,5}$/i, '');
  return parts.slice(-count).join('/');
}

/** Split text into lowercase word tokens, also breaking camelCase and letter/digit runs. */
function tokens(text) {
  return String(text || '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([a-zA-Z])(\d)/g, '$1 $2')
    .replace(/(\d)([a-zA-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

// Tokens that mark a size/device variant of the same picture (hero.jpg vs hero-mobile.jpg).
const VARIANT_TOKENS = new Set([
  'mob', 'mobile', 'm', 'sm', 'small', 'xs', 'md', 'lg', 'large', 'xl', 'xxl', 'desktop', 'desk', 'dsk',
  'web', 'tab', 'tablet', 'thumb', 'thumbs', 'thumbnail', 'min', 'scaled', 'resized', 'compressed',
  'optimized', 'optimised', 'hd', 'full', 'big', 'orig', 'original', 'retina', 'hires', 'lowres',
  'portrait', 'landscape', 'pc', 'x',
]);
const WIDTH_TOKENS = new Set([
  '320', '360', '375', '400', '414', '480', '540', '576', '600', '640', '720', '750', '768', '800', '828',
  '900', '960', '992', '1024', '1080', '1140', '1200', '1280', '1366', '1400', '1440', '1536', '1600',
  '1920', '2048', '2400', '2560', '3200', '3840',
]);

/**
 * Groups size/device variants of one picture: "img/banner.webp", "img/banner-mob.webp",
 * "img/banner-1400.webp" → "img/banner". Used so a size folder never gets two crops of
 * the same scene.
 */
function familyKey(url, fallback) {
  if (!url || url.startsWith('data:')) return `data:${fallback || ''}`;
  const parts = effectivePath(url).split('/').filter(Boolean);
  if (!parts.length) return url;
  const file = parts.pop().replace(/\.[a-z0-9]{2,5}$/i, '').replace(/@\d+(\.\d+)?x$/i, '');
  const clean = (s) => {
    const kept = tokens(s).filter((t) => !VARIANT_TOKENS.has(t) && !WIDTH_TOKENS.has(t) && !/^\d{2,4}x\d{2,4}$/.test(t));
    return kept.join('-');
  };
  // WordPress style "-1024x683" suffix and plain dimension suffixes.
  const stem = clean(file.replace(/-\d{2,5}x\d{2,5}$/i, '')) || file.toLowerCase();
  const dir = parts.slice(-2).map(clean).filter(Boolean).join('/');
  return `${dir}/${stem}`;
}

function decodeDataUri(uri) {
  const m = /^data:([^;,]*)((?:;[^;,]*)*?),(.*)$/s.exec(uri);
  if (!m) return null;
  try {
    const isBase64 = /;base64/i.test(m[2]);
    const buffer = isBase64 ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]), 'utf8');
    return { buffer, contentType: m[1] || 'application/octet-stream' };
  } catch {
    return null;
  }
}

/** Run `fn` over `items` with at most `limit` concurrent promises; keeps order. */
async function mapPool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}

function displayUrl(url, max = 110) {
  if (!url) return '';
  if (url.startsWith('data:image/svg')) return '(inline SVG from page)';
  if (url.startsWith('data:')) return '(inline data URI)';
  return url.length > max ? `${url.slice(0, max - 3)}...` : url;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Folder-safe name derived from a URL's host, e.g. https://www.abc.com → abc.com */
function folderNameFromUrl(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./i, '');
    return host.replace(/[^a-z0-9.-]+/gi, '-') || 'website-images';
  } catch {
    return 'website-images';
  }
}

module.exports = {
  sha1,
  normalizeUrl,
  effectivePath,
  fileStem,
  pathText,
  tokens,
  familyKey,
  decodeDataUri,
  mapPool,
  displayUrl,
  formatBytes,
  folderNameFromUrl,
};
