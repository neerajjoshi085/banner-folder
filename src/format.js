export const cx = (...classes) => classes.filter(Boolean).join(' ');

export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** image.png, image-1.png, image-2.png … (the packager's naming). */
export const bannerFile = (index) => (index === 0 ? 'image.png' : `image-${index}.png`);

export const dims = (w, h) => `${w} × ${h}`;

export function parseSize(text) {
  const [w, h] = String(text || '').split('x').map(Number);
  return [w || 1, h || 1];
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function formatDuration(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  return `${Math.floor(s / 60)} min ${s % 60} s`;
}

export function formatClock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function formatHours(minutes) {
  if (minutes < 120) return plural(minutes, 'minute', 'minutes');
  return plural(Math.round(minutes / 60), 'hour', 'hours');
}

export function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./i, '');
  } catch {
    return url;
  }
}

export function shortUrl(url, max = 64) {
  const s = String(url || '').replace(/^https?:\/\//, '');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export const isWebUrl = (s) => /^https?:\/\//i.test(String(s || '')) && !String(s).endsWith('...');

const RATIOS = [
  [1, '1:1'], [1.91, '1.91:1'], [0.8, '4:5'], [0.5625, '9:16'], [4, '4:1'], [16 / 9, '16:9'], [4 / 3, '4:3'], [0.75, '3:4'],
];

export function ratioLabel(w, h) {
  const r = w / h;
  const hit = RATIOS.find(([v]) => Math.abs(v - r) / v < 0.01);
  return hit ? hit[1] : `${r.toFixed(2)}:1`;
}

export function shapeLabel(w, h) {
  const r = w / h;
  if (r > 1.05) return 'Landscape';
  if (r < 0.95) return 'Portrait';
  return 'Square';
}

/** The packager's messages name CLI flags; point to the matching form fields instead. */
export function humanize(text) {
  return String(text || '')
    .replace(/\s+[–-]\s+try --headed, or --browser chrome\./, '.')
    .replace(/Could not download --logo /, 'Could not download the logo from ')
    .replace(/^--logo is not a usable image/, 'The logo is not a usable image')
    .replace(/(use one with |with )?--logo( <file-or-url>| <url>)?/g, (m, prefix) => `${prefix || ''}the Logo setting under More options`)
    .replace(/--max-upscale/g, 'the Maximum enlargement setting')
    .replace(/--include-hero/g, 'the Use hero images setting');
}
