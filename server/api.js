import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import express from 'express';
import sharp from 'sharp';
import packager from 'website-image-packager';
import {
  createRequestParser, DEFAULT_MAX_UPSCALE, DEFAULT_MOBILE_PASS, DEFAULT_TIMEOUT_SECONDS, LIMITS, CROPS,
} from './validate.js';

const require = createRequire(import.meta.url);
const { version: packagerVersion } = require('website-image-packager/package.json');
const { LAYOUT, DEFAULTS } = packager;

const SERVABLE_RE = /\.(png|webp)$/i;
const THUMB_SIZE = 800;

/** Maps a wildcard route param onto a file inside `root`, or null if it is not a package image. */
export function resolveFile(root, param) {
  const parts = Array.isArray(param) ? param : String(param ?? '').split('/');
  if (!parts.length || parts.some((p) => !p || p.startsWith('.') || /[\\:\0]/.test(p))) return null;
  if (!SERVABLE_RE.test(parts[parts.length - 1])) return null;
  const full = path.join(root, ...parts);
  const rel = path.relative(root, full);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return { full, rel: parts.join('/') };
}

const inFlight = new Map();

/** WebP preview (longest side 800 px), cached next to the package so it never ends up in the ZIP. */
function thumbnail(job, file) {
  const dest = path.join(job.dir, '.thumbs', `${file.rel.replace(/\//g, '__')}.webp`);
  if (fs.existsSync(dest)) return Promise.resolve(dest);
  if (!inFlight.has(dest)) {
    const work = (async () => {
      await fs.promises.mkdir(path.dirname(dest), { recursive: true });
      const partial = dest.replace(/\.webp$/, '.part.webp');
      await sharp(file.full)
        .resize({ width: THUMB_SIZE, height: THUMB_SIZE, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 80 })
        .toFile(partial);
      await fs.promises.rename(partial, dest);
      return dest;
    })().finally(() => inFlight.delete(dest));
    inFlight.set(dest, work);
  }
  return inFlight.get(dest);
}

export function createApi({ jobs, config }) {
  const api = express.Router();
  const parseJobRequest = createRequestParser({
    allowPrivateUrls: config.allowPrivateUrls,
    findJob: (id) => jobs.get(id),
  });

  const findJob = (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job) res.status(404).json({ error: 'This package has expired or never existed.' });
    return job;
  };
  // With `root`, the dotfile check only applies to `rel` (already validated), not to
  // folders above it such as the .thumbs cache or a JOBS_DIR under ~/.cache.
  const sendImage = (res, root, rel) => {
    res.set('Cache-Control', 'private, max-age=3600');
    res.sendFile(rel, { root, cacheControl: false, dotfiles: 'deny' }, (err) => {
      if (err && !res.headersSent) res.status(404).json({ error: 'File not found.' });
    });
  };

  api.use(express.json({ limit: '12mb' }));

  api.get('/config', (req, res) => {
    res.json({
      packagerVersion,
      layout: LAYOUT,
      defaults: {
        imagesPerSize: DEFAULTS.imagesPerSize,
        maxUpscale: DEFAULT_MAX_UPSCALE,
        crop: DEFAULTS.crop,
        logoBackground: DEFAULTS.logoBackground,
        includeHero: false,
        mobilePass: DEFAULT_MOBILE_PASS,
        timeoutSeconds: DEFAULT_TIMEOUT_SECONDS,
      },
      limits: LIMITS,
      crops: CROPS,
      jobTtlMinutes: config.jobTtlMinutes,
    });
  });

  api.post('/jobs', async (req, res) => {
    const spec = await parseJobRequest(req.body);
    const job = jobs.create({ ...spec, client: req.ip });
    res.status(202).json(jobs.toPublic(job));
  });

  api.get('/jobs/:id', (req, res) => {
    const job = findJob(req, res);
    if (job) res.json(jobs.toPublic(job));
  });

  api.get('/jobs/:id/events', (req, res) => {
    const job = jobs.get(req.params.id);
    if (job) return jobs.subscribe(job, res);
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end('event: gone\ndata: {}\n\n');
  });

  api.get('/jobs/:id/download', (req, res) => {
    const job = findJob(req, res);
    if (!job) return;
    if (!job.zip) return res.status(409).json({ error: 'The package is not ready yet.' });
    res.download(job.zip.path, job.zip.file);
  });

  api.get('/jobs/:id/files/*file', (req, res) => {
    const job = findJob(req, res);
    if (!job) return;
    const file = resolveFile(job.outDir, req.params.file);
    if (!file) return res.status(404).json({ error: 'File not found.' });
    sendImage(res, job.outDir, file.rel);
  });

  api.get('/jobs/:id/thumbs/*file', async (req, res) => {
    const job = findJob(req, res);
    if (!job) return;
    const file = resolveFile(job.outDir, req.params.file);
    if (!file || !fs.existsSync(file.full)) return res.status(404).json({ error: 'File not found.' });
    const thumb = await thumbnail(job, file);
    sendImage(res, path.dirname(thumb), path.basename(thumb));
  });

  api.use((req, res) => res.status(404).json({ error: 'Not found.' }));

  // Express recognises error handlers by their four parameters.
  api.use((err, req, res, next) => {
    if (err.type === 'entity.too.large') {
      return res.status(413).json({ error: 'The logo file is too large. Use a file under 8 MB.', field: 'logoData' });
    }
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Send the package settings as JSON.' });
    const status = err.status || 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? 'Something went wrong on the server. Try again.' : err.message, field: err.field });
  });

  return api;
}
