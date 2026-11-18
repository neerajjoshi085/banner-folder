import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { config } from './config.js';
import { JobManager } from './jobs.js';
import { createApi } from './api.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const dev = process.argv.includes('--dev');

if (!dev && !fs.existsSync(path.join(dist, 'index.html'))) {
  console.error('The website has not been built yet. Run "npm run build" first, or "npm run dev" while developing.');
  process.exit(1);
}

// Vite's dev server injects inline scripts, so the policy is only sent for the built site.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob: https: http:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join('; ');

const jobs = new JobManager(config);
await jobs.init();

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', config.trustProxy);
app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' });
  if (!dev) res.set('Content-Security-Policy', CSP);
  next();
});
app.get('/healthz', (req, res) => res.json({ ok: true, running: jobs.running, queued: jobs.queue.length }));
app.use('/api', createApi({ jobs, config }));

const server = http.createServer(app);

if (dev) {
  const { createServer } = await import('vite');
  const vite = await createServer({ root, server: { middlewareMode: true, hmr: { server } }, appType: 'spa' });
  app.use(vite.middlewares);
} else {
  app.use(
    express.static(dist, {
      setHeaders(res, file) {
        const hashed = file.includes(`${path.sep}assets${path.sep}`);
        res.set('Cache-Control', hashed ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    }),
  );
}

server.listen(config.port, config.host, () => {
  const host = ['127.0.0.1', '0.0.0.0', '::'].includes(config.host) ? 'localhost' : config.host;
  console.log(`Website Image Packager${dev ? ' (dev)' : ''} running at http://${host}:${config.port}`);
});

const shutdown = () => {
  server.close(() => process.exit(0));
  server.closeAllConnections();
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
