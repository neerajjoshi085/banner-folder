'use strict';

/*
 * These functions are serialised by Playwright and executed INSIDE the web page.
 * They must be completely self-contained: no imports, no references to outer scope.
 */

/** Scrolls the whole page so lazy-loaded images, sliders and backgrounds load. */
async function autoScrollPage(maxMs) {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  try {
    document.querySelectorAll('img[loading="lazy"]').forEach((img) => {
      img.loading = 'eager';
    });
  } catch (e) {
    /* ignore */
  }
  const scroller = document.scrollingElement || document.documentElement;
  const step = Math.max(250, Math.floor(window.innerHeight * 0.8));
  const started = Date.now();
  let stable = 0;
  let lastHeight = 0;
  while (Date.now() - started < maxMs) {
    window.scrollBy(0, step);
    await sleep(200);
    const height = scroller.scrollHeight;
    const atBottom = window.scrollY + window.innerHeight >= height - 4;
    if (atBottom) {
      if (height === lastHeight) {
        stable += 1;
        if (stable >= 3) break;
      } else {
        stable = 0;
      }
      await sleep(350);
    }
    lastHeight = height;
  }
  window.scrollTo(0, 0);
  await sleep(300);
  return { height: scroller.scrollHeight, ms: Date.now() - started };
}

/** Collects every image reference on the page together with layout/context hints. */
function collectImageCandidates() {
  const results = [];
  const IMG_EXT_RE = /\.(jpe?g|png|webp|avif|gif|svg|bmp|tiff?)(?:[?#]|$)/i;
  const GALLERY_NAME_RE = /(gallery|galleries|portfolio)/;
  const HERO_NAME_RE = /(hero|banner|masthead|jumbotron|main-?slider|home-?slider|top-?slider|vegas|main-?carousel|home-?carousel)/;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  function abs(value, base) {
    if (!value || typeof value !== 'string') return null;
    let u = value.trim().replace(/^['"]|['"]$/g, '');
    if (!u || u === '#' || /^(blob:|about:|javascript:)/i.test(u)) return null;
    if (/^data:/i.test(u)) return /^data:image\//i.test(u) && u.length > 400 ? u : null;
    try {
      return new URL(u, base || document.baseURI).href;
    } catch (e) {
      return null;
    }
  }

  // srcset parser following the HTML spec's URL/descriptor tokenisation.
  function largestFromSrcset(srcset, base) {
    if (!srcset) return null;
    const s = String(srcset);
    let i = 0;
    let best = null;
    let bestScore = -1;
    while (i < s.length) {
      while (i < s.length && /[\s,]/.test(s[i])) i += 1;
      if (i >= s.length) break;
      let start = i;
      while (i < s.length && !/\s/.test(s[i])) i += 1;
      let url = s.slice(start, i);
      let desc = '';
      if (/,$/.test(url)) {
        url = url.replace(/,+$/, '');
      } else {
        start = i;
        while (i < s.length && s[i] !== ',') i += 1;
        desc = s.slice(start, i).trim();
      }
      const m = /^(\d+(?:\.\d+)?)([wxh])$/i.exec(desc);
      const score = m ? (m[2].toLowerCase() === 'x' ? parseFloat(m[1]) * 1000 : parseFloat(m[1])) : 1;
      if (url && score > bestScore) {
        bestScore = score;
        best = url;
      }
    }
    return best ? abs(best, base) : null;
  }

  function classOf(node) {
    const c = node.getAttribute && node.getAttribute('class');
    return typeof c === 'string' ? c : '';
  }

  const nameOf = (n) => `${n.id || ''} ${classOf(n)}`.toLowerCase();
  const isGalleryNamed = (n) => GALLERY_NAME_RE.test(nameOf(n));

  // The website's gallery section: a container named gallery/portfolio, a lightbox
  // gallery group, or a <section> whose heading says "Gallery".
  function inGallerySection(el) {
    for (let n = el; n && n.nodeType === 1 && n !== document.body; n = n.parentElement) {
      const extra = `${n.getAttribute('data-fancybox') || ''} ${n.getAttribute('data-lightbox') || ''} ${n.getAttribute('data-gallery') || ''}`;
      if (GALLERY_NAME_RE.test(`${nameOf(n)} ${extra.toLowerCase()}`)) return true;
    }
    const sec = el.closest && el.closest('section, article');
    if (sec) {
      const heading = sec.querySelector('h1, h2, h3, h4');
      if (heading && /\b(gallery|photo gallery|photos|project images)\b/i.test(heading.textContent || '')) return true;
    }
    return false;
  }

  // Hero section(s): top-of-page blocks named hero/banner/main-slider/…; if none,
  // the large visual block in the middle of the first screen.
  const heroRoots = [];
  document.querySelectorAll('[id], [class]').forEach((n) => {
    if (n === document.body || n === document.documentElement) return;
    if (!HERO_NAME_RE.test(nameOf(n)) || isGalleryNamed(n) || (n.parentElement && n.parentElement.closest('[class*="gallery" i], [id*="gallery" i]'))) return;
    const r = n.getBoundingClientRect();
    const top = r.top + window.scrollY;
    if (r.width >= vw * 0.5 && r.height >= 120 && r.height <= vh * 1.6 && top < vh * 0.9) heroRoots.push(n);
  });
  if (!heroRoots.length) {
    const stack = document.elementsFromPoint(vw / 2, Math.min(vh * 0.5, 450));
    for (const n of stack) {
      if (n === document.body || n === document.documentElement) break;
      const r = n.getBoundingClientRect();
      if (r.width < vw * 0.9 || r.height < vh * 0.4 || r.height > vh * 1.6 || isGalleryNamed(n)) continue;
      if (getComputedStyle(n).backgroundImage !== 'none' || n.querySelector('img, picture, video')) heroRoots.push(n);
    }
  }
  const inHeroRoot = (el) => heroRoots.some((h) => h === el || h.contains(el));

  function describe(el) {
    if (!el || el.nodeType !== 1) {
      return { self: '', ctx: '', section: '', alt: '', x: 0, y: 0, w: 0, h: 0, visible: false, inHeader: false, inFooter: false, inGallery: false, inHero: false, homeLink: false };
    }
    const self = [];
    const anc = [];
    let node = el;
    let depth = 0;
    // Stop below <body>: page-wide <html>/<body> classes say nothing about this image's section.
    while (node && node.nodeType === 1 && node !== document.body && node !== document.documentElement && depth < 9) {
      // id + class only: tag names (button, main, a…) would pollute keyword matching.
      const text = `${node.id || ''} ${classOf(node)}`.trim().toLowerCase();
      if (depth <= 1) self.push(text);
      else anc.push(text);
      node = node.parentElement;
      depth += 1;
    }
    let rect = { left: 0, top: 0, width: 0, height: 0 };
    try {
      rect = el.getBoundingClientRect();
    } catch (e) {
      /* ignore */
    }
    const visible = rect.width > 1 && rect.height > 1;
    const y = rect.top + window.scrollY;
    const ctx = `${self.join(' ')} ${anc.join(' ')}`;
    let homeLink = false;
    const link = el.closest && el.closest('a[href]');
    if (link) {
      try {
        const raw = link.getAttribute('href') || '';
        if (/^#(home|top|hero|banner|main|header)?$/i.test(raw)) {
          homeLink = true;
        } else {
          const h = new URL(raw, document.baseURI);
          const strip = (p) => p.replace(/index\.(html?|php|aspx?)$/i, '');
          homeLink = h.origin === location.origin && !h.hash && (strip(h.pathname) === '/' || strip(h.pathname) === strip(location.pathname));
        }
      } catch (e) {
        /* ignore */
      }
    }
    const alt = el.getAttribute('alt') || el.getAttribute('aria-label') || el.getAttribute('title') || '';
    const sec = el.parentElement && el.parentElement.closest('section, article, aside, [role="region"]');
    const section = sec ? `${sec.id || ''} ${classOf(sec)}`.trim().toLowerCase() : '';
    const gallery = inGallerySection(el);
    return {
      self: self.join(' '),
      ctx,
      section,
      alt,
      x: rect.left + window.scrollX,
      y,
      w: rect.width,
      h: rect.height,
      visible,
      inHeader: !!(el.closest && el.closest('header, nav, [class*="header" i], [id*="header" i], [class*="navbar" i], [class*="topbar" i], [class*="top-bar" i]')),
      inFooter: !!(el.closest && el.closest('footer, [class*="footer" i], [id*="footer" i]')),
      inGallery: gallery,
      inHero: !gallery && (inHeroRoot(el) || (visible && y < vh * 0.5 && rect.width >= vw * 0.6 && rect.height >= vh * 0.35)),
      homeLink,
    };
  }

  function add(url, source, info, extra) {
    if (!url) return;
    results.push(Object.assign({ url, source }, info || describe(null), extra || {}));
  }

  // 1. <img> elements: src, currentSrc, srcset and common lazy-load attributes.
  const LAZY_ATTRS = [
    'data-src', 'data-lazy-src', 'data-original', 'data-lazy', 'data-url', 'data-full', 'data-full-src',
    'data-large', 'data-large-src', 'data-zoom-image', 'data-hi-res', 'data-highres', 'data-retina',
    'data-image', 'data-img', 'data-desktop', 'data-mobile', 'data-src-desktop', 'data-src-mobile',
  ];
  document.querySelectorAll('img').forEach((img) => {
    const info = describe(img);
    const natural = { naturalWidth: img.naturalWidth || 0, naturalHeight: img.naturalHeight || 0 };
    add(abs(img.currentSrc), 'img', info, natural);
    add(abs(img.getAttribute('src')), 'img', info);
    add(largestFromSrcset(img.getAttribute('srcset')), 'img', info);
    add(largestFromSrcset(img.getAttribute('data-srcset') || img.getAttribute('data-lazy-srcset')), 'img', info);
    for (const attr of LAZY_ATTRS) {
      const v = img.getAttribute(attr);
      if (v) add(abs(v), 'img', info);
    }
  });

  // 2. <picture><source> (all media variants, incl. mobile-only art direction).
  document.querySelectorAll('picture source').forEach((source) => {
    const pic = source.closest('picture');
    const img = pic && pic.querySelector('img');
    const info = describe(img || source.parentElement);
    const url = largestFromSrcset(source.getAttribute('srcset') || source.getAttribute('data-srcset'));
    add(url, 'picture', info, { media: source.getAttribute('media') || '' });
  });

  // 3. Links straight to image files (lightbox / gallery full-size images).
  document.querySelectorAll('a[href]').forEach((a) => {
    const href = a.getAttribute('href');
    if (href && IMG_EXT_RE.test(href)) {
      const img = a.querySelector('img');
      add(abs(href), 'link', describe(img || a));
    }
  });

  // 4. <video poster> and SVG <image>.
  document.querySelectorAll('video[poster]').forEach((v) => add(abs(v.getAttribute('poster')), 'poster', describe(v)));
  document.querySelectorAll('svg image').forEach((im) => {
    add(abs(im.getAttribute('href') || im.getAttribute('xlink:href')), 'svg-image', describe(im));
  });

  // 5. Every element: data-* attributes holding image URLs + computed CSS backgrounds.
  const URL_RE = /url\(\s*(['"]?)(.*?)\1\s*\)/g;
  document.querySelectorAll('body *').forEach((el) => {
    let info = null;
    const getInfo = () => {
      if (!info) info = describe(el);
      return info;
    };
    if (el.tagName !== 'IMG' && el.tagName !== 'SOURCE') {
      for (const attr of Array.from(el.attributes)) {
        if (!attr.name.startsWith('data-') || !attr.value) continue;
        if (/srcset/i.test(attr.name)) {
          add(largestFromSrcset(attr.value), 'data-attr', getInfo());
        } else if (IMG_EXT_RE.test(attr.value) || /^data:image\//i.test(attr.value)) {
          const value = attr.value.trim();
          if (/^url\(/i.test(value)) {
            for (const m of value.matchAll(URL_RE)) add(abs(m[2]), 'data-attr', getInfo());
          } else if (!/\s/.test(value)) {
            add(abs(value), 'data-attr', getInfo());
          }
        }
      }
    }
    for (const pseudo of [null, '::before', '::after']) {
      let bg = '';
      try {
        bg = getComputedStyle(el, pseudo).backgroundImage;
      } catch (e) {
        continue;
      }
      if (!bg || bg === 'none' || bg.indexOf('url(') === -1) continue;
      for (const m of bg.matchAll(URL_RE)) add(abs(m[2]), 'css-bg', getInfo());
    }
  });

  // 6. Stylesheet rules (catches backgrounds inside media queries, e.g. mobile banners).
  const walkRules = (rules, sheetHref, media) => {
    for (const rule of Array.from(rules || [])) {
      try {
        if (rule.styleSheet) {
          walkRules(rule.styleSheet.cssRules, rule.styleSheet.href || sheetHref, media);
          continue;
        }
        if (rule.cssRules && !rule.style) {
          walkRules(rule.cssRules, sheetHref, (rule.media && rule.media.mediaText) || rule.conditionText || media);
          continue;
        }
        if (!rule.style) continue;
        const bg = `${rule.style.getPropertyValue('background-image') || ''} ${rule.style.getPropertyValue('background') || ''}`;
        if (bg.indexOf('url(') === -1) continue;
        const selector = rule.selectorText || '';
        let target = null;
        try {
          target = document.querySelector(selector.replace(/::?(before|after|hover|focus|active|visited)\b/gi, ''));
        } catch (e) {
          target = null;
        }
        const info = target ? describe(target) : Object.assign(describe(null), { self: selector.toLowerCase(), ctx: selector.toLowerCase() });
        if (!target) {
          info.inGallery = GALLERY_NAME_RE.test(info.ctx);
          info.inHero = !info.inGallery && HERO_NAME_RE.test(info.ctx);
        }
        for (const m of bg.matchAll(URL_RE)) add(abs(m[2], sheetHref || document.baseURI), 'css-rule', info, { media: media || '' });
      } catch (e) {
        /* ignore rule */
      }
    }
  };
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      walkRules(sheet.cssRules, sheet.href, sheet.media && sheet.media.mediaText);
    } catch (e) {
      /* cross-origin stylesheet: not readable */
    }
  }

  // 7. Meta tags, icons and JSON-LD structured data.
  const META = [
    ['meta[property="og:image"]', 'og-image'],
    ['meta[property="og:image:url"]', 'og-image'],
    ['meta[property="og:image:secure_url"]', 'og-image'],
    ['meta[name="twitter:image"]', 'og-image'],
    ['meta[name="twitter:image:src"]', 'og-image'],
    ['meta[itemprop="image"]', 'og-image'],
    ['link[rel="image_src"]', 'og-image'],
    ['meta[property="og:logo"]', 'meta-logo'],
    ['meta[itemprop="logo"]', 'meta-logo'],
  ];
  for (const [selector, source] of META) {
    document.querySelectorAll(selector).forEach((m) => add(abs(m.getAttribute('content') || m.getAttribute('href')), source, null));
  }
  document.querySelectorAll('link[rel][href]').forEach((link) => {
    const rel = (link.getAttribute('rel') || '').toLowerCase();
    if (/(^|\s)(icon|apple-touch-icon|apple-touch-icon-precomposed|mask-icon)(\s|$)/.test(rel)) {
      add(abs(link.getAttribute('href')), 'icon', null, { sizes: link.getAttribute('sizes') || '' });
    }
  });
  document.querySelectorAll('script[type="application/ld+json"]').forEach((script) => {
    let data;
    try {
      data = JSON.parse(script.textContent);
    } catch (e) {
      return;
    }
    const walk = (value, key, depth) => {
      if (value == null || depth > 10) return;
      if (typeof value === 'string') {
        if (key === 'logo') add(abs(value), 'jsonld-logo', null);
        else if (key === 'image' || key === 'thumbnailUrl' || key === 'contentUrl') add(abs(value), 'jsonld-image', null);
        return;
      }
      if (Array.isArray(value)) {
        value.forEach((v) => walk(v, key, depth + 1));
        return;
      }
      if (typeof value === 'object') {
        for (const k of Object.keys(value)) {
          const passKey = (k === 'url' || k === 'contentUrl') && (key === 'logo' || key === 'image') ? key : k;
          walk(value[k], passKey, depth + 1);
        }
      }
    };
    walk(data, '', 0);
  });

  // 8. Inline <svg> logos (serialised with computed styles so they render standalone).
  const SVG_PROPS = [
    'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap',
    'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'opacity', 'clip-rule', 'font-family',
    'font-size', 'font-weight', 'font-style', 'letter-spacing', 'text-anchor', 'dominant-baseline',
    'stop-color', 'stop-opacity', 'visibility', 'display',
  ];
  const serializeSvg = (svg) => {
    try {
      const clone = svg.cloneNode(true);
      const src = [svg].concat(Array.from(svg.querySelectorAll('*')));
      const dst = [clone].concat(Array.from(clone.querySelectorAll('*')));
      for (let i = 0; i < src.length && i < dst.length; i += 1) {
        const cs = getComputedStyle(src[i]);
        let style = dst[i].getAttribute('style') || '';
        for (const p of SVG_PROPS) {
          const v = cs.getPropertyValue(p);
          if (v) style += `;${p}:${v}`;
        }
        dst[i].setAttribute('style', style.replace(/^;/, ''));
      }
      const r = svg.getBoundingClientRect();
      if (!clone.getAttribute('viewBox')) clone.setAttribute('viewBox', `0 0 ${r.width} ${r.height}`);
      clone.setAttribute('width', String(Math.max(1, Math.round(r.width))));
      clone.setAttribute('height', String(Math.max(1, Math.round(r.height))));
      const uses = clone.querySelectorAll('use');
      if (uses.length) {
        const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
        uses.forEach((u) => {
          const ref = u.getAttribute('href') || u.getAttribute('xlink:href');
          if (ref && ref.startsWith('#')) {
            const target = document.getElementById(ref.slice(1));
            if (target && !svg.contains(target)) defs.appendChild(target.cloneNode(true));
          }
        });
        if (defs.childNodes.length) clone.insertBefore(defs, clone.firstChild);
      }
      const xml = new XMLSerializer().serializeToString(clone);
      if (xml.length > 3000000) return null;
      return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(xml)))}`;
    } catch (e) {
      return null;
    }
  };
  document.querySelectorAll('svg').forEach((svg) => {
    if (svg.parentElement && svg.parentElement.closest('svg')) return; // nested svg
    const info = describe(svg);
    const titleEl = svg.querySelector('title');
    const label = `${svg.getAttribute('aria-label') || ''} ${titleEl ? titleEl.textContent : ''}`.trim();
    const logoish = /logo|brand/.test(`${info.ctx} ${label.toLowerCase()}`) || (info.homeLink && info.inHeader);
    if (!logoish || !info.visible || info.w < 40 || info.h < 14) return;
    const data = serializeSvg(svg);
    if (data) add(data, 'inline-svg', Object.assign(info, { alt: label || info.alt }));
  });

  return results;
}

module.exports = { autoScrollPage, collectImageCandidates };
