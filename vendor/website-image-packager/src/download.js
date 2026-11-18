'use strict';

const fs = require('fs');
const path = require('path');
const { request } = require('playwright');
const { analyzeImage } = require('./analyze');
const { decodeDataUri, mapPool, displayUrl, normalizeUrl } = require('./utils');
const { PackagerError, firstLine } = require('./errors');
const { finaliseOverride } = require('./select');

const ACCEPT = 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8';

async function createHttpClient(site, opts) {
  return request.newContext({
    userAgent: site.userAgent,
    ignoreHTTPSErrors: true,
    timeout: opts.requestTimeout,
    extraHTTPHeaders: { Accept: ACCEPT, Referer: site.finalUrl || site.requestedUrl },
  });
}

async function fetchBytes(url, http, opts) {
  if (url.startsWith('data:')) {
    const decoded = decodeDataUri(url);
    return decoded && decoded.buffer.length ? { ok: true, ...decoded } : { ok: false, error: 'invalid data URI' };
  }
  let lastError = 'unknown error';
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const res = await http.get(url, { timeout: opts.requestTimeout, maxRedirects: 5, failOnStatusCode: false });
      if (!res.ok()) {
        lastError = `HTTP ${res.status()}`;
        if (res.status() < 500) break; // 4xx will not change on retry
        continue;
      }
      const length = Number(res.headers()['content-length'] || 0);
      if (length > opts.maxImageBytes) return { ok: false, error: 'file too large' };
      const buffer = await res.body();
      if (buffer.length > opts.maxImageBytes) return { ok: false, error: 'file too large' };
      return { ok: true, buffer, contentType: res.headers()['content-type'] || '' };
    } catch (err) {
      lastError = firstLine(err);
    }
  }
  return { ok: false, error: lastError };
}

/**
 * Downloads (or re-uses browser-captured bytes for) every candidate, validates it and
 * attaches analysis results. Returns valid images plus rejection statistics.
 */
async function collectImages(site, opts, log) {
  const stats = { references: site.candidates.length, downloadFailed: 0, unsupported: 0, broken: 0, tooSmall: 0, skipped: 0 };
  let candidates = site.candidates;
  if (candidates.length > opts.maxCandidates) {
    stats.skipped = candidates.length - opts.maxCandidates;
    candidates = candidates.slice(0, opts.maxCandidates);
  }
  const http = await createHttpClient(site, opts);
  try {
    const results = await mapPool(candidates, opts.concurrency, async (cand) => {
      const cached = site.captured.get(cand.key);
      const got = cached ? { ok: true, ...cached } : await fetchBytes(cand.url, http, opts);
      if (!got.ok) {
        stats.downloadFailed += 1;
        log.debug(`download failed (${got.error}): ${displayUrl(cand.url)}`);
        return null;
      }
      const info = await analyzeImage(got.buffer);
      if (!info.ok) {
        stats[info.reason] = (stats[info.reason] || 0) + 1;
        log.debug(`${info.reason} image (${info.detail}): ${displayUrl(cand.url)}`);
        return null;
      }
      if (!info.isSvg && (info.width < 48 || info.height < 24)) {
        stats.tooSmall += 1;
        return null;
      }
      return { ...cand, ...info, buffer: got.buffer };
    });
    const images = results.filter(Boolean);
    stats.valid = images.length;
    return { images, stats };
  } finally {
    await http.dispose().catch(() => {});
  }
}

/** Loads a user-supplied logo (--logo) from a local file or URL. */
async function loadLogoOverride(source, site, opts) {
  let buffer;
  let url = source;
  if (/^(https?:|data:)/i.test(source)) {
    const http = await createHttpClient(site, opts);
    try {
      const got = await fetchBytes(source, http, opts);
      if (!got.ok) throw new PackagerError(`Could not download --logo ${source}: ${got.error}`);
      buffer = got.buffer;
    } finally {
      await http.dispose().catch(() => {});
    }
  } else {
    const file = path.resolve(source);
    if (!fs.existsSync(file)) throw new PackagerError(`--logo file not found: ${file}`);
    buffer = fs.readFileSync(file);
    url = file;
  }
  const info = await analyzeImage(buffer);
  if (!info.ok) throw new PackagerError(`--logo is not a usable image (${info.detail || info.reason})`);
  return finaliseOverride({ url, key: normalizeUrl(url), buffer, ...info });
}

module.exports = { collectImages, loadLogoOverride };
