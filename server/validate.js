import dns from 'node:dns';
import net from 'node:net';
import packager from 'website-image-packager';

const { DEFAULTS } = packager;

/** Web limits. Tighter than the CLI's where a single request could tie up the server. */
export const LIMITS = Object.freeze({
  imagesPerSize: [1, 10],
  maxUpscale: [1, 10000],
  timeoutSeconds: [5, 120],
});

export const DEFAULT_MAX_UPSCALE = LIMITS.maxUpscale[1];
export const DEFAULT_MOBILE_PASS = false;
export const DEFAULT_TIMEOUT_SECONDS = 30;
const WEB_REQUEST_TIMEOUT_MS = 15_000;
export const CROPS = Object.freeze(['attention', 'entropy', 'center']);
export const MAX_LOGO_BYTES = 8 * 1024 * 1024;

const LOGO_DATA_RE = /^data:image\/(png|jpeg|webp|gif|avif|svg\+xml);base64,([a-z0-9+/]+=*)$/i;
const COLOR_RE = /^(white|transparent|#[0-9a-f]{6})$/i;

export class InputError extends Error {
  constructor(message, field) {
    super(message);
    this.name = 'InputError';
    this.status = 400;
    this.field = field;
  }
}

/* Private-network guard ---------------------------------------------------- */

const blockList = new net.BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) blockList.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of [
  ['::', 96], ['::1', 128], ['100::', 64], ['2001:db8::', 32], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8],
]) blockList.addSubnet(address, prefix, 'ipv6');

/** Expands an IPv6 address into its eight 16-bit groups. */
function ipv6Groups(ip) {
  let s = ip.toLowerCase().replace(/%.*$/, '');
  const dotted = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(s);
  if (dotted) {
    const [a, b, c, d] = dotted.slice(1).map(Number);
    s = `${s.slice(0, -dotted[0].length)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, tail] = s.split('::');
  const h = head ? head.split(':') : [];
  const t = tail === undefined ? [] : tail ? tail.split(':') : [];
  const fill = tail === undefined ? [] : Array(Math.max(0, 8 - h.length - t.length)).fill('0');
  return [...h, ...fill, ...t].map((g) => Number.parseInt(g || '0', 16));
}

/** True for loopback, private, link-local, reserved and multicast addresses. */
export function isPrivateAddress(ip) {
  const family = net.isIP(ip);
  if (family === 4) return blockList.check(ip, 'ipv4');
  if (family !== 6) return true;
  const g = ipv6Groups(ip);
  // IPv4-mapped (::ffff:a.b.c.d) is checked against the IPv4 rules.
  if (g.length === 8 && g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) {
    return blockList.check(`${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`, 'ipv4');
  }
  return blockList.check(ip.replace(/%.*$/, ''), 'ipv6');
}

/* Field parsers ------------------------------------------------------------ */

export function normalizeUrl(input, field = 'url') {
  let s = String(input ?? '').trim();
  if (!s) throw new InputError('Enter the website address.', field);
  if (s.length > 2048) throw new InputError('That address is too long.', field);
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `https://${s}`;
  let u;
  try {
    u = new URL(s);
  } catch {
    throw new InputError(`"${String(input).slice(0, 100)}" is not a web address.`, field);
  }
  if (!/^https?:$/.test(u.protocol)) throw new InputError('Only http:// and https:// addresses can be opened.', field);
  if (u.username || u.password) throw new InputError('Remove the user name and password from the address.', field);
  if (!u.hostname.includes('.') && !u.hostname.startsWith('[')) {
    throw new InputError(`"${u.hostname}" is not a full domain name. Use something like example.com.`, field);
  }
  u.hash = '';
  return u;
}

/** Folder and ZIP name: letters, digits, dot, dash, underscore. Defaults to the domain. */
export function packageName(input, url) {
  const raw = String(input ?? '').trim();
  const base = raw || url.hostname.replace(/^www\./i, '');
  const clean = base
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
    .slice(0, 80);
  if (!clean) {
    if (raw) throw new InputError('Use letters, numbers, dots, dashes or underscores in the package name.', 'name');
    return 'website-images';
  }
  return /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(clean) ? `${clean}-package` : clean;
}

function number(body, key, fallback, label, { integer = true } = {}) {
  const value = body[key];
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  const [min, max] = LIMITS[key];
  if (!Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n))) {
    throw new InputError(`${label} must be ${integer ? 'a whole number' : 'a number'} from ${min} to ${max}.`, key);
  }
  return n;
}

function bool(body, key, fallback) {
  const value = body[key];
  if (value === undefined || value === null) return fallback;
  return value === true || value === 'true' || value === 1 || value === '1';
}

/**
 * Builds the request parser. `lookup` and `findJob` are injectable for tests.
 * Returns { url, name, options, logo } where options are packageWebsite() settings.
 */
export function createRequestParser({ allowPrivateUrls = false, lookup = dns.promises.lookup, findJob = () => null } = {}) {
  async function assertPublicHost(u, field) {
    if (allowPrivateUrls) return;
    const host = u.hostname.replace(/^\[|\]$/g, '');
    let addresses;
    if (net.isIP(host)) {
      addresses = [{ address: host }];
    } else {
      try {
        addresses = await lookup(host, { all: true, verbatim: true });
      } catch {
        throw new InputError(`Couldn't find ${host}. Check the address for typos.`, field);
      }
    }
    if (!addresses.length || addresses.some((a) => isPrivateAddress(a.address))) {
      throw new InputError(`${host} points to a private network address, which this server doesn't open.`, field);
    }
  }

  async function parseLogo(body) {
    const mode = body.logoMode || 'auto';
    if (mode === 'auto') return null;
    if (mode === 'url') {
      const u = normalizeUrl(body.logoUrl, 'logoUrl');
      await assertPublicHost(u, 'logoUrl');
      return { mode, value: u.href, name: u.href };
    }
    if (mode === 'upload') {
      if (!body.logoData && body.reuseLogoFrom) {
        const previous = findJob(String(body.reuseLogoFrom));
        if (previous && previous.logo && previous.logo.mode === 'upload') return previous.logo;
        throw new InputError('The uploaded logo has expired. Choose the file again.', 'logoData');
      }
      const match = LOGO_DATA_RE.exec(String(body.logoData || ''));
      if (!match) throw new InputError('Choose a PNG, JPEG, WebP, GIF, AVIF or SVG file for the logo.', 'logoData');
      if (Math.floor((match[2].length * 3) / 4) > MAX_LOGO_BYTES) {
        throw new InputError('The logo file is larger than 8 MB.', 'logoData');
      }
      const name = String(body.logoName || 'logo').replace(/[^\w .()-]+/g, '').slice(0, 100) || 'logo';
      return { mode, value: match[0], name };
    }
    throw new InputError('Choose how the logo should be found.', 'logoMode');
  }

  return async function parseJobRequest(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new InputError('Send the package settings as JSON.');
    const url = normalizeUrl(body.url, 'url');
    await assertPublicHost(url, 'url');

    const crop = body.crop || DEFAULTS.crop;
    if (!CROPS.includes(crop)) throw new InputError('Crop focus must be attention, entropy or center.', 'crop');
    const logoBackground = String(body.logoBackground || DEFAULTS.logoBackground).toLowerCase();
    if (!COLOR_RE.test(logoBackground)) {
      throw new InputError('Logo background must be white, transparent or a #rrggbb colour.', 'logoBackground');
    }

    const options = {
      imagesPerSize: number(body, 'imagesPerSize', DEFAULTS.imagesPerSize, 'Images per size'),
      maxUpscale: number(body, 'maxUpscale', DEFAULT_MAX_UPSCALE, 'Maximum enlargement', { integer: false }),
      crop,
      logoBackground,
      includeHero: bool(body, 'includeHero', false),
      gallery: false,
      mobilePass: bool(body, 'mobilePass', DEFAULT_MOBILE_PASS),
      timeout: number(body, 'timeoutSeconds', DEFAULT_TIMEOUT_SECONDS, 'Page load timeout') * 1000,
      requestTimeout: WEB_REQUEST_TIMEOUT_MS,
    };

    return { url: url.href, name: packageName(body.name, url), options, logo: await parseLogo(body) };
  };
}
