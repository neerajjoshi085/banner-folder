'use strict';

const { chromium } = require('playwright');
const { autoScrollPage, collectImageCandidates } = require('./page-scripts');
const { normalizeUrl, pathText, familyKey, sha1 } = require('./utils');
const { PackagerError, firstLine } = require('./errors');

const MIN_CAPTURE_BYTES = 1500;

const PROFILES = {
  desktop: {
    name: 'desktop',
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2, // makes srcset/currentSrc resolve to high-resolution variants
    isMobile: false,
    hasTouch: false,
  },
  mobile: {
    name: 'mobile',
    viewport: { width: 412, height: 915 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  },
};

async function launchBrowser(opts, log) {
  const channels = opts.browser ? [opts.browser] : [undefined, 'msedge', 'chrome'];
  const errors = [];
  for (const channel of channels) {
    try {
      const browser = await chromium.launch({ headless: !opts.headed, channel });
      log.debug(`browser: ${channel || 'bundled chromium'} ${browser.version()}`);
      return browser;
    } catch (err) {
      errors.push(`${channel || 'bundled chromium'}: ${firstLine(err)}`);
    }
  }
  throw new PackagerError(
    `Could not start a Chromium browser.\n  ${errors.join('\n  ')}\n` +
      'Install the bundled browser with:  npx playwright install chromium\n' +
      'or use an installed browser with:  --browser chrome   (or --browser msedge)',
    { code: 'E_BROWSER' },
  );
}

function userAgentFor(profile, browserVersion) {
  const major = String(browserVersion || '130').split('.')[0];
  return profile.isMobile
    ? `Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Mobile Safari/537.36`
    : `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}

async function captureResponse(response, captured, maxBytes) {
  try {
    const url = response.url();
    if (!/^https?:/i.test(url)) return;
    const type = String(response.headers()['content-type'] || '').toLowerCase();
    if (response.request().resourceType() !== 'image' && !type.startsWith('image/')) return;
    const status = response.status();
    if (status < 200 || status >= 300) return;
    const key = normalizeUrl(url);
    if (captured.has(key)) return;
    const body = await response.body();
    if (!body || body.length < MIN_CAPTURE_BYTES || body.length > maxBytes) return;
    captured.set(key, { buffer: body, contentType: type });
  } catch {
    // Body not available (redirect, aborted request, …) – it will be downloaded later.
  }
}

async function runPass(browser, url, profile, opts, log) {
  const context = await browser.newContext({
    viewport: profile.viewport,
    deviceScaleFactor: profile.deviceScaleFactor,
    isMobile: profile.isMobile,
    hasTouch: profile.hasTouch,
    userAgent: userAgentFor(profile, browser.version()),
    ignoreHTTPSErrors: true,
    locale: 'en-US',
  });
  const captured = new Map();
  const pending = [];
  try {
    const page = await context.newPage();
    page.on('response', (res) => pending.push(captureResponse(res, captured, opts.maxImageBytes)));

    let response;
    try {
      response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: opts.timeout });
    } catch (err) {
      throw new PackagerError(`Could not open ${url} (${profile.name}): ${firstLine(err)}`, { cause: err, code: 'E_NAVIGATION' });
    }
    const status = response ? response.status() : 0;
    await page.waitForLoadState('load', { timeout: Math.min(opts.timeout, 10000) }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    const scroll = await page.evaluate(autoScrollPage, opts.scrollMs).catch((err) => {
      log.debug(`auto-scroll failed: ${firstLine(err)}`);
      return null;
    });
    if (scroll) log.debug(`${profile.name}: scrolled ${scroll.height}px in ${scroll.ms}ms`);
    await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(500);

    const found = await page.evaluate(collectImageCandidates);
    const title = await page.title().catch(() => '');
    const finalUrl = page.url();
    await Promise.allSettled(pending);
    return { candidates: found.map((c) => ({ ...c, pass: profile.name })), captured, status, title, finalUrl };
  } finally {
    await context.close().catch(() => {});
  }
}

function pushUnique(list, value, max = 8) {
  if (value && !list.includes(value) && list.length < max) list.push(value);
}

/** Merges raw page references into one record per image URL. */
function mergeCandidates(raw, captured) {
  const map = new Map();
  const ensure = (url) => {
    const key = url.startsWith('data:') ? `data:${sha1(url)}` : normalizeUrl(url);
    let rec = map.get(key);
    if (!rec) {
      rec = {
        url,
        key,
        order: map.size,
        sources: new Set(),
        passes: new Set(),
        selfParts: [],
        ctxParts: [],
        sectionParts: [],
        alts: [],
        media: [],
        inHeader: false,
        inFooter: false,
        inGallery: false,
        inHero: false,
        homeLink: false,
        visible: false,
        minY: Infinity,
        maxArea: 0,
      };
      map.set(key, rec);
    }
    return rec;
  };

  for (const c of raw) {
    if (!c || !c.url) continue;
    const rec = ensure(c.url);
    rec.sources.add(c.source);
    if (c.pass) rec.passes.add(c.pass);
    pushUnique(rec.selfParts, c.self);
    pushUnique(rec.ctxParts, c.ctx);
    pushUnique(rec.sectionParts, c.section);
    pushUnique(rec.alts, (c.alt || '').trim());
    pushUnique(rec.media, c.media);
    rec.inHeader = rec.inHeader || !!c.inHeader;
    rec.inFooter = rec.inFooter || !!c.inFooter;
    rec.inGallery = rec.inGallery || !!c.inGallery;
    rec.inHero = rec.inHero || !!c.inHero;
    rec.homeLink = rec.homeLink || !!c.homeLink;
    if (c.visible) {
      rec.visible = true;
      rec.minY = Math.min(rec.minY, c.y);
      rec.maxArea = Math.max(rec.maxArea, c.w * c.h);
    }
  }

  // Images the browser loaded that are not referenced in the final DOM (JS sliders etc.).
  for (const key of captured.keys()) {
    if (!map.has(key)) ensure(key).sources.add('network');
  }

  return [...map.values()].map((rec) => finaliseCandidate(rec));
}

function finaliseCandidate(rec) {
  const path = pathText(rec.url);
  return {
    ...rec,
    family: familyKey(rec.url, rec.key),
    pathText: path,
    // filename + alt text + the element's own/parent class & id
    selfText: [path, ...rec.alts, ...rec.selfParts].join(' ').toLowerCase(),
    altText: rec.alts.join(' ').toLowerCase(),
    classText: rec.selfParts.join(' ').toLowerCase(),
    // ancestor chain (containers up to <body>)
    ctxText: rec.ctxParts.join(' ').toLowerCase(),
    // enclosing <section>/<article> id + class (e.g. "section floor-plans")
    sectionText: rec.sectionParts.join(' ').toLowerCase(),
  };
}

/**
 * Opens the website in headless Chromium (desktop + mobile viewports), scrolls it,
 * and returns every image reference plus the image bytes the browser downloaded.
 */
async function extractFromWebsite(url, opts, log) {
  const browser = await launchBrowser(opts, log);
  try {
    const passes = [PROFILES.desktop];
    if (opts.mobilePass) passes.push(PROFILES.mobile);
    const raw = [];
    const captured = new Map();
    let first = null;
    for (const profile of passes) {
      log.debug(`${profile.name} scan…`);
      let result;
      try {
        result = await runPass(browser, first ? first.finalUrl : url, profile, opts, log);
      } catch (err) {
        if (!first) throw err;
        log.warn(`${profile.name} scan failed, continuing with desktop results: ${firstLine(err)}`);
        continue;
      }
      if (!first) first = result;
      raw.push(...result.candidates);
      for (const [k, v] of result.captured) if (!captured.has(k)) captured.set(k, v);
      log.debug(`${profile.name}: ${result.candidates.length} references, ${result.captured.size} images captured`);
    }
    if (first.status >= 400) log.warn(`the page answered HTTP ${first.status}; results may be incomplete`);
    return {
      requestedUrl: url,
      finalUrl: first.finalUrl,
      title: first.title,
      status: first.status,
      candidates: mergeCandidates(raw, captured),
      captured,
      userAgent: userAgentFor(PROFILES.desktop, browser.version()),
    };
  } finally {
    await browser.close().catch(() => {});
  }
}

module.exports = { extractFromWebsite, mergeCandidates, launchBrowser };
