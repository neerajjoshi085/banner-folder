import { hostOf } from './format.js';

/** Form fields that live under "More options" (used to open it when one has an error). */
export const OPTION_FIELDS = [
  'imagesPerSize', 'maxUpscale', 'crop', 'includeHero', 'mobilePass', 'timeoutSeconds', 'logoMode', 'logoUrl', 'logoData',
  'logoBackground',
];

export function defaultForm(config) {
  const d = config.defaults;
  return {
    url: '',
    name: '',
    imagesPerSize: d.imagesPerSize,
    maxUpscale: d.maxUpscale,
    crop: d.crop,
    includeHero: d.includeHero,
    mobilePass: d.mobilePass,
    timeoutSeconds: d.timeoutSeconds,
    logoMode: 'auto',
    logoUrl: '',
    logoFile: null, // { name, size, dataUrl }
    reuseLogoFrom: null, // job id whose uploaded logo the server can reuse
    reuseLogoName: '',
    logoBgMode: d.logoBackground === 'transparent' ? 'transparent' : 'white',
    logoBgColor: '#ffffff',
  };
}

/** Restores the form from a job opened by link, so it can be tweaked and rebuilt. */
export function formFromJob(config, job) {
  const s = job.settings;
  const bg = s.logoBackground;
  return {
    ...defaultForm(config),
    url: job.url,
    name: job.name === hostOf(job.url) ? '' : job.name,
    imagesPerSize: s.imagesPerSize,
    maxUpscale: s.maxUpscale,
    crop: s.crop,
    includeHero: s.includeHero,
    mobilePass: s.mobilePass,
    timeoutSeconds: s.timeoutSeconds,
    logoMode: s.logoMode,
    logoUrl: s.logoUrl || '',
    reuseLogoFrom: s.logoMode === 'upload' ? job.id : null,
    reuseLogoName: s.logoName || '',
    logoBgMode: bg === 'white' || bg === 'transparent' ? bg : 'color',
    logoBgColor: bg.startsWith('#') ? bg : '#ffffff',
  };
}

export const logoBackgroundOf = (form) => (form.logoBgMode === 'color' ? form.logoBgColor : form.logoBgMode);

export function requestFromForm(form) {
  const upload = form.logoMode === 'upload';
  return {
    url: form.url,
    name: form.name,
    imagesPerSize: form.imagesPerSize,
    maxUpscale: form.maxUpscale,
    crop: form.crop,
    includeHero: form.includeHero,
    mobilePass: form.mobilePass,
    timeoutSeconds: form.timeoutSeconds,
    logoBackground: logoBackgroundOf(form),
    logoMode: form.logoMode,
    logoUrl: form.logoMode === 'url' ? form.logoUrl : undefined,
    logoData: upload && form.logoFile ? form.logoFile.dataUrl : undefined,
    logoName: upload && form.logoFile ? form.logoFile.name : undefined,
    reuseLogoFrom: upload && !form.logoFile ? form.reuseLogoFrom : undefined,
  };
}

/** How many settings under "More options" differ from the defaults. */
export function changedCount(config, form) {
  const d = config.defaults;
  const numbers = ['imagesPerSize', 'maxUpscale', 'timeoutSeconds'];
  let n = numbers.filter((k) => Number(form[k]) !== d[k]).length;
  n += ['crop', 'includeHero', 'mobilePass'].filter((k) => form[k] !== d[k]).length;
  if (form.logoMode !== 'auto') n += 1;
  if (logoBackgroundOf(form) !== d.logoBackground) n += 1;
  return n;
}

export const clampInt = (value, fallback, min, max) => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
};
