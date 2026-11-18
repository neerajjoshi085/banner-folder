import { useEffect, useRef, useState } from 'react';
import { zipUrl } from '../api.js';
import { cx, dims, formatBytes, formatClock, formatDuration, formatHours, hostOf, humanize, plural } from '../format.js';

const STEPS = [
  { key: 'open', label: 'Open the site' },
  { key: 'download', label: 'Check images' },
  { key: 'logos', label: 'Make logos' },
  { key: 'banners', label: 'Crop banners' },
  { key: 'zip', label: 'Pack the ZIP' },
];

const LEVEL_PREFIX = { warn: 'Warning: ', error: 'Error: ' };

function useNow(active) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

/** Files in the ZIP that could not be made (banner shortfalls and both logo files). */
export function missingFiles(result) {
  const banners = result.banners.reduce((n, b) => n + Math.max(0, b.expected - b.files.length), 0);
  return banners + (result.logos.length ? 0 : 2);
}

function describe(config, jobState) {
  const job = jobState.data;
  if (!jobState.id) {
    return {
      title: 'Your package, drawn to scale',
      detail: 'Each frame below is one file in the ZIP, shown at its real proportions. The frames fill in as the photos are cropped.',
    };
  }
  if (jobState.gone) {
    return {
      title: 'This package has expired',
      detail: `Packages are kept for ${formatHours(config.jobTtlMinutes)} after they're built, or until the server restarts. Build it again with the form above.`,
    };
  }
  if (!job) return { title: 'Loading the package…' };

  if (job.status === 'queued') {
    return {
      title: 'Waiting for a free browser',
      detail: job.position > 1 ? `${plural(job.position - 1, 'package is', 'packages are')} ahead of yours.` : 'Your package is next.',
    };
  }
  if (job.status === 'running') {
    const logoSizes = config.layout.logos.map((l) => dims(l.width, l.height)).join(' and ');
    switch (job.stage) {
      case 'download':
        return { title: 'Checking the images', detail: 'Downloading every image on the page and setting aside broken files, duplicates, icons and floor plans.' };
      case 'logos':
        return { title: 'Making the logos', detail: `Trimming the logo and centring it on the ${logoSizes} canvases.` };
      case 'banners':
        return { title: 'Cropping the banners', detail: 'Cropping photos to each banner size. Nothing is stretched.' };
      case 'zip':
        return { title: 'Packing the ZIP', detail: 'Almost done.' };
      default:
        return {
          title: `Opening ${hostOf(job.url)}`,
          detail: `Loading the page in a headless browser and scrolling to the bottom${job.settings.mobilePass ? ', then again at phone size' : ''}.`,
        };
    }
  }
  if (job.status === 'failed') {
    return { title: "Couldn't build the package", detail: humanize(job.error && job.error.message), tone: 'error' };
  }

  const gaps = missingFiles(job.result);
  if (gaps) {
    return { title: 'Package ready, with gaps', detail: `${plural(gaps, "file couldn't", "files couldn't")} be made. The notes on the sheet say why.` };
  }
  return { title: 'Package ready', detail: `Every file was made from ${hostOf(job.result.finalUrl || job.url)}.` };
}

function Steps({ job, now }) {
  const steps = STEPS;
  const stage = job.status === 'running' && job.stage === 'queued' ? 'open' : job.stage;
  const current = steps.findIndex((s) => s.key === stage);
  const elapsed = job.startedAt ? (job.finishedAt || now) - job.startedAt : 0;

  return (
    <div className="progress">
      <ol className="steps">
        {steps.map((step, i) => {
          let state = 'todo';
          if (job.status === 'done' || i < current) state = 'done';
          else if (i === current) state = job.status === 'failed' ? 'failed' : 'current';
          return (
            <li key={step.key} className={cx('step', `is-${state}`)} aria-current={state === 'current' ? 'step' : undefined}>
              <span className="step-num" aria-hidden="true">
                {state === 'done' ? '✓' : state === 'failed' ? '!' : i + 1}
              </span>
              <span>
                {step.label}
                <span className="visually-hidden">{state === 'done' ? ', done' : state === 'failed' ? ', failed' : ''}</span>
              </span>
            </li>
          );
        })}
      </ol>
      {job.startedAt && (
        <span className="elapsed" aria-label={`Time taken: ${formatDuration(elapsed)}`}>
          {formatClock(elapsed)}
        </span>
      )}
    </div>
  );
}

function fixesFor(job) {
  const r = job.result;
  const s = job.settings;
  const shortBanners = r.banners.some((b) => b.files.length < b.expected);
  const hero = (r.stats && r.stats.heroExcluded) || 0;
  const fixes = [];
  if (shortBanners && s.maxUpscale < 10000) {
    fixes.push({ label: 'Rebuild using photos of any size', overrides: { maxUpscale: 10000 } });
  }
  if (shortBanners && !s.includeHero && hero > 0) {
    fixes.push({ label: `Rebuild using the ${plural(hero, 'hero image', 'hero images')}`, overrides: { includeHero: true } });
  }
  return fixes;
}

function statsSentence(job) {
  const s = job.result.stats || {};
  const broken = (s.broken || 0) + (s.unsupported || 0) + (s.downloadFailed || 0);
  const parts = [
    `${s.valid || 0} valid`,
    plural(s.duplicatesRemoved || 0, 'duplicate', 'duplicates'),
    `${broken} broken or unreachable`,
    plural(s.photos || 0, 'usable photo', 'usable photos'),
    `${s.graphics || 0} icons, graphics and plans skipped`,
  ];
  const hero = s.heroExcluded ? ` ${plural(s.heroExcluded, 'hero image was', 'hero images were')} left out.` : '';
  return `Scanned ${plural(s.references || 0, 'image reference', 'image references')} in ${formatDuration(job.finishedAt - job.startedAt)}: ${parts.join(', ')}.${hero}`;
}

function ResultNotes({ job, onRebuild }) {
  const fixes = fixesFor(job);
  const { warnings } = job.result;
  return (
    <div className="result-notes">
      <p className="stats">{statsSentence(job)}</p>
      {warnings.length > 0 && (
        <ul className="warnings">
          {warnings.map((w) => (
            <li key={w}>{humanize(w)}</li>
          ))}
        </ul>
      )}
      {fixes.length > 0 && (
        <div className="fixes">
          <p className="fixes-title">Ways to fill the gaps</p>
          <div className="fixes-actions">
            {fixes.map((f) => (
              <button key={f.label} type="button" className="button button-ghost" onClick={() => onRebuild(f.overrides)}>
                {f.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ActivityLog({ logs, live }) {
  const [open, setOpen] = useState(false);
  const [details, setDetails] = useState(false);
  const listRef = useRef(null);
  const stick = useRef(true);
  const lines = details ? logs : logs.filter((l) => l.level !== 'debug');

  useEffect(() => {
    const el = listRef.current;
    if (open && el && stick.current) el.scrollTop = el.scrollHeight;
  }, [open, lines.length]);

  return (
    <details className="log" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        Activity log <span className="log-count">{plural(lines.length, 'line', 'lines')}</span>
      </summary>
      <label className="log-toggle">
        <input type="checkbox" checked={details} onChange={(e) => setDetails(e.target.checked)} /> Show every image the packager checked
      </label>
      <ol
        ref={listRef}
        className="log-lines"
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {lines.map((l, i) => (
          <li key={`${l.t}-${i}`} className={cx('log-line', `is-${l.level}`)}>
            {LEVEL_PREFIX[l.level] || ''}
            {l.text}
          </li>
        ))}
      </ol>
    </details>
  );
}

export function StatusPanel({ config, jobState, onRebuild }) {
  const job = jobState.data;
  const live = !!job && (job.status === 'running' || job.status === 'queued');
  const now = useNow(live) - jobState.clockOffset;
  const text = describe(config, jobState);

  return (
    <div className="status" id="progress">
      <div className="status-head">
        <div className="status-text" role="status">
          <h2 className={cx('status-title', text.tone === 'error' && 'is-error')}>{text.title}</h2>
          {text.detail && <p className="status-detail">{text.detail}</p>}
        </div>
        {job && job.status === 'done' && job.zip && (
          <div className="downloads">
            <a className="button button-mark" href={zipUrl(job.id)} download>
              Download ZIP <span className="button-meta">{formatBytes(job.zip.bytes)}</span>
            </a>
          </div>
        )}
      </div>
      {job && <Steps job={job} now={now} />}
      {job && job.status === 'done' && <ResultNotes job={job} onRebuild={onRebuild} />}
      {job && job.logs.length > 0 && <ActivityLog logs={job.logs} live={live} />}
    </div>
  );
}
