import os from 'node:os';
import path from 'node:path';

const positiveInt = (value, fallback) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/** Express "trust proxy" accepts true/false, a hop count, or a list of addresses. */
const trustProxy = (value) => {
  if (value === undefined || value === '' || value === 'false') return false;
  if (value === 'true') return true;
  const n = Number(value);
  return Number.isInteger(n) ? n : value;
};

export const config = Object.freeze({
  port: positiveInt(process.env.PORT, 3000),
  host: process.env.HOST || '127.0.0.1',
  jobsDir: process.env.JOBS_DIR
    ? path.resolve(process.env.JOBS_DIR)
    : path.join(os.tmpdir(), 'website-image-packager-web'),
  maxConcurrentJobs: positiveInt(process.env.MAX_CONCURRENT_JOBS, 2),
  maxQueuedJobs: positiveInt(process.env.MAX_QUEUED_JOBS, 20),
  maxJobsPerClient: positiveInt(process.env.MAX_JOBS_PER_CLIENT, 2),
  jobTtlMinutes: positiveInt(process.env.JOB_TTL_MINUTES, 360),
  allowPrivateUrls: process.env.ALLOW_PRIVATE_URLS === '1',
  trustProxy: trustProxy(process.env.TRUST_PROXY),
});
