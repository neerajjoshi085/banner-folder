import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import packager from 'website-image-packager';

const { packageWebsite, zipPackage, toJsonReport } = packager;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_LOG_LINES = 3000;
const MAX_LOG_CHARS = 2000;

/** Packager log steps → stage keys shown in the progress track. */
const STAGE_PATTERNS = [
  [/^Opening /, 'open'],
  [/^Downloading and validating/, 'download'],
  [/^(Loading logo|Creating logos)/, 'logos'],
  [/^Rendering banner sizes/, 'banners'],
];
/** "  1200x628: 4/4" – logged after each banner size has been written. */
const SIZE_LINE_RE = /^\s*(\d+x\d+): (\d+)\/(\d+)\s*$/;

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const isFinished = (job) => job.status === 'done' || job.status === 'failed';

export class JobManager {
  constructor(config) {
    this.config = config;
    this.ttlMs = config.jobTtlMinutes * 60_000;
    this.jobs = new Map();
    this.queue = [];
    this.running = 0;
  }

  /** Creates the jobs folder and removes job folders left over from a previous run. */
  async init() {
    await fs.promises.mkdir(this.config.jobsDir, { recursive: true });
    for (const entry of await fs.promises.readdir(this.config.jobsDir, { withFileTypes: true })) {
      if (entry.isDirectory() && UUID_RE.test(entry.name)) {
        await fs.promises.rm(path.join(this.config.jobsDir, entry.name), { recursive: true, force: true }).catch(() => {});
      }
    }
    this.cleanupTimer = setInterval(() => this.cleanup(), 5 * 60_000);
    this.cleanupTimer.unref();
  }

  get(id) {
    return UUID_RE.test(String(id)) ? this.jobs.get(id) : undefined;
  }

  create({ url, name, options, logo, client }) {
    const active = [...this.jobs.values()].filter((j) => j.client === client && !isFinished(j)).length;
    if (active >= this.config.maxJobsPerClient) {
      throw new HttpError(429, `You already have ${active} packages building. Wait for one to finish, then try again.`);
    }
    if (this.queue.length >= this.config.maxQueuedJobs) {
      throw new HttpError(503, 'The server is busy with other packages. Try again in a few minutes.');
    }
    const id = crypto.randomUUID();
    const dir = path.join(this.config.jobsDir, id);
    const job = {
      id,
      dir,
      outDir: path.join(dir, name),
      url,
      name,
      options,
      logo,
      client,
      status: 'queued',
      stage: 'queued',
      createdAt: Date.now(),
      startedAt: null,
      finishedAt: null,
      logs: [],
      logosReady: false,
      readySizes: {},
      result: null,
      publicResult: null,
      zip: null,
      error: null,
      listeners: new Set(),
    };
    this.jobs.set(id, job);
    this.queue.push(job);
    this.pump();
    return job;
  }

  pump() {
    while (this.running < this.config.maxConcurrentJobs && this.queue.length) {
      const job = this.queue.shift();
      this.running += 1;
      this.run(job).finally(() => {
        this.running -= 1;
        this.pump();
      });
    }
    this.queue.forEach((job, i) => this.emit(job, 'update', { position: i + 1 }));
  }

  async run(job) {
    job.status = 'running';
    job.startedAt = Date.now();
    this.emit(job, 'update', { status: job.status, startedAt: job.startedAt, position: 0 });
    try {
      await fs.promises.mkdir(job.dir, { recursive: true });
      const result = await packageWebsite({
        ...job.options,
        url: job.url,
        outDir: job.outDir,
        logo: job.logo ? job.logo.value : undefined,
        logger: this.loggerFor(job),
      });
      this.log(job, 'step', 'Packing the ZIP file');
      const zip = await zipPackage(result.outDir);
      job.zip = { path: zip.path, file: path.basename(zip.path), bytes: zip.bytes };
      job.result = result;
      job.publicResult = this.publicResult(job);
      job.status = 'done';
    } catch (err) {
      job.status = 'failed';
      job.error = { message: this.clean(job, err && err.message ? err.message : String(err)), code: (err && err.code) || 'E_INTERNAL' };
      if (!(err && err.name === 'PackagerError')) console.error(`[job ${job.id}]`, err);
      await fs.promises.rm(job.dir, { recursive: true, force: true }).catch(() => {});
    }

    job.finishedAt = Date.now();
    this.emit(job, 'snapshot', this.toPublic(job));
    for (const res of job.listeners) res.end();
    job.listeners.clear();
  }

  loggerFor(job) {
    const make = (level) => (...args) => this.log(job, level, args.join(' '));
    return { level: 'debug', error: make('error'), warn: make('warn'), info: make('info'), step: make('step'), debug: make('debug') };
  }

  log(job, level, raw) {
    const text = this.clean(job, raw);
    const entry = { t: Date.now(), level, text };
    job.logs.push(entry);
    if (job.logs.length > MAX_LOG_LINES) job.logs.splice(0, job.logs.length - MAX_LOG_LINES);
    this.emit(job, 'log', entry);

    if (level === 'step') {
      const stage = text === 'Packing the ZIP file' ? 'zip' : (STAGE_PATTERNS.find(([re]) => re.test(text)) || [])[1];
      if (stage) this.setStage(job, stage);
    } else if (level === 'info' && job.stage === 'banners') {
      const m = SIZE_LINE_RE.exec(text);
      if (m) {
        job.readySizes = { ...job.readySizes, [m[1]]: Number(m[2]) };
        this.emit(job, 'update', { readySizes: job.readySizes });
      }
    }
  }

  setStage(job, stage) {
    if (job.stage === stage) return;
    const patch = { stage };
    // Logo files exist once the packager has moved past the logo step.
    if (job.stage === 'logos') {
      job.logosReady = true;
      patch.logosReady = true;
    }
    job.stage = stage;
    this.emit(job, 'update', patch);
  }

  /** Keeps uploaded logos and inline images out of logs and messages, and caps their length. */
  clean(job, text) {
    let s = String(text);
    if (job.logo && job.logo.mode === 'upload') s = s.split(job.logo.value).join('the uploaded logo');
    s = s.replace(/data:[^\s"')]{120,}/g, '(embedded image)');
    return s.length > MAX_LOG_CHARS ? `${s.slice(0, MAX_LOG_CHARS)}…` : s;
  }

  cleanSource(job, source) {
    if (!source) return source;
    if (job.logo && job.logo.mode === 'upload' && source === job.logo.value) return '(uploaded logo)';
    if (source.startsWith('data:image/svg')) return '(inline SVG from the page)';
    if (source.startsWith('data:')) return '(image embedded in the page)';
    return source;
  }

  /** The packager result without server paths or embedded image data. */
  publicResult(job) {
    const r = toJsonReport(job.result);
    const src = (s) => this.cleanSource(job, s);
    delete r.outDir;
    r.name = job.name;
    r.logos = r.logos.map((l) => ({ ...l, source: src(l.source) }));
    r.banners = r.banners.map((b) => ({ ...b, files: b.files.map((f) => ({ ...f, source: src(f.source) })) }));
    r.gallery = r.gallery.map((g) => ({ ...g, source: src(g.source) }));
    r.missing = r.missing.map((m) => this.clean(job, m));
    r.warnings = r.warnings.map((w) => this.clean(job, w));
    return r;
  }

  settings(job) {
    const { timeout, requestTimeout, ...rest } = job.options;
    return {
      ...rest,
      timeoutSeconds: Math.round(timeout / 1000),
      logoMode: job.logo ? job.logo.mode : 'auto',
      logoUrl: job.logo && job.logo.mode === 'url' ? job.logo.value : '',
      logoName: job.logo && job.logo.mode === 'upload' ? job.logo.name : '',
    };
  }

  toPublic(job) {
    return {
      id: job.id,
      status: job.status,
      stage: job.stage,
      url: job.url,
      name: job.name,
      settings: this.settings(job),
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      expiresAt: job.finishedAt ? job.finishedAt + this.ttlMs : null,
      position: job.status === 'queued' ? this.queue.indexOf(job) + 1 : 0,
      logosReady: job.logosReady,
      readySizes: job.readySizes,
      logs: job.logs,
      error: job.error,
      result: job.publicResult,
      zip: job.zip ? { file: job.zip.file, bytes: job.zip.bytes } : null,
      serverTime: Date.now(),
    };
  }

  /** Server-sent events: one snapshot, then live updates until the job finishes. */
  subscribe(job, res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(`event: snapshot\ndata: ${JSON.stringify(this.toPublic(job))}\n\n`);
    if (isFinished(job)) {
      res.end();
      return;
    }
    job.listeners.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 20_000);
    // The response's close event fires when the client disconnects.
    res.on('close', () => {
      clearInterval(ping);
      job.listeners.delete(res);
    });
  }

  emit(job, event, data) {
    if (!job.listeners.size) return;
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of job.listeners) res.write(payload);
  }

  async cleanup() {
    const now = Date.now();
    for (const job of [...this.jobs.values()]) {
      if (job.finishedAt && now - job.finishedAt > this.ttlMs) {
        this.jobs.delete(job.id);
        await fs.promises.rm(job.dir, { recursive: true, force: true }).catch(() => {});
      }
    }
  }
}
