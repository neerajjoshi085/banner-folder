import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createJob, getConfig } from './api.js';
import { BuildForm } from './components/BuildForm.jsx';
import { Sheet } from './components/Sheet.jsx';
import { StatusPanel } from './components/StatusPanel.jsx';
import { Viewer } from './components/Viewer.jsx';
import { clampInt, defaultForm, formFromJob, logoBackgroundOf, requestFromForm } from './form.js';
import { formatHours, hostOf } from './format.js';
import { useJob } from './useJob.js';

const JOB_HASH_RE = /^#\/jobs\/([0-9a-f-]{36})$/i;
const NO_SIZES = {};

function jobIdFromHash() {
  const match = JOB_HASH_RE.exec(window.location.hash);
  return match ? match[1] : null;
}

function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="6" fill="#245c4c" />
      <rect x="9" y="11" width="14" height="10" fill="#f4f8f6" />
      <path d="M3 11h4M9 4v5M25 11h4M23 4v5M3 21h4M9 23v5M25 21h4M23 23v5" stroke="#f2d04b" strokeWidth="1.6" />
    </svg>
  );
}

/** Brings the progress panel into view when it is off screen. */
function revealProgress() {
  requestAnimationFrame(() => {
    const el = document.getElementById('progress');
    if (!el) return;
    const top = el.getBoundingClientRect().top;
    if (top < 0 || top > window.innerHeight * 0.5) {
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    }
  });
}

export default function App() {
  const [config, setConfig] = useState(null);
  const [configError, setConfigError] = useState(null);
  const [form, setForm] = useState(null);
  const [jobId, setJobId] = useState(jobIdFromHash);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [viewerItem, setViewerItem] = useState(null);
  const jobState = useJob(jobId);
  const job = jobState.data;
  const prefilledFor = useRef(null);
  const formRef = useRef(form);
  formRef.current = form;

  useEffect(() => {
    getConfig()
      .then((c) => {
        setConfig(c);
        setForm((f) => f || defaultForm(c));
      })
      .catch((err) => setConfigError(err.message));
  }, []);

  useEffect(() => {
    const sync = () => setJobId(jobIdFromHash());
    window.addEventListener('hashchange', sync);
    window.addEventListener('popstate', sync);
    return () => {
      window.removeEventListener('hashchange', sync);
      window.removeEventListener('popstate', sync);
    };
  }, []);

  // A package opened by link fills the form with its settings, ready to tweak and rebuild.
  useEffect(() => {
    if (!config || !job || prefilledFor.current === job.id) return;
    prefilledFor.current = job.id;
    setForm(formFromJob(config, job));
  }, [config, job]);

  const jobStatus = job ? job.status : null;
  const jobUrl = job ? job.url : null;
  useEffect(() => {
    const host = jobUrl ? hostOf(jobUrl) : '';
    const titles = {
      queued: `Building ${host}…`,
      running: `Building ${host}…`,
      done: `${host} package ready`,
      failed: `Couldn't build ${host}`,
    };
    document.title = jobStatus ? `${titles[jobStatus]} – Website Image Packager` : 'Website Image Packager';
  }, [jobStatus, jobUrl]);

  const submit = useCallback(async (values) => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const created = await createJob(requestFromForm(values));
      prefilledFor.current = created.id;
      window.history.pushState(null, '', `#/jobs/${created.id}`);
      setJobId(created.id);
      revealProgress();
    } catch (err) {
      setSubmitError({ message: err.message, field: err.field });
    } finally {
      setSubmitting(false);
    }
  }, []);

  const updateForm = useCallback((patch) => {
    setForm((f) => ({ ...f, ...patch }));
    setSubmitError(null);
  }, []);

  const rebuild = useCallback(
    (overrides) => {
      const next = { ...formRef.current, ...overrides };
      setForm(next);
      submit(next);
    },
    [submit],
  );

  const goHome = (e) => {
    e.preventDefault();
    window.history.pushState(null, '', window.location.pathname + window.location.search);
    setJobId(null);
  };

  // Only the fields the sheet draws, so log lines don't re-render every frame.
  const settings = job ? job.settings : null;
  const view = useMemo(() => {
    if (!config || !form) return null;
    const d = config.defaults;
    let status = 'idle';
    if (jobState.gone) status = 'gone';
    else if (jobStatus) status = jobStatus;
    else if (jobState.id) status = 'loading';
    return {
      jobId: job ? job.id : null,
      status,
      perSize: settings ? settings.imagesPerSize : clampInt(form.imagesPerSize, d.imagesPerSize, ...config.limits.imagesPerSize),
      logoBackground: settings ? settings.logoBackground : logoBackgroundOf(form),
      logosReady: job ? job.logosReady : false,
      readySizes: (job && job.readySizes) || NO_SIZES,
      result: job ? job.result : null,
    };
  }, [
    config, jobState.gone, jobState.id, jobStatus, settings, job && job.id, job && job.logosReady, job && job.readySizes,
    job && job.result, form && form.imagesPerSize, form && form.logoBgMode,
    form && form.logoBgColor,
  ]);

  return (
    <>
      <header className="masthead">
        <a className="brand" href="/" onClick={goHome}>
          <BrandMark />
          Website Image Packager
        </a>
      </header>

      <main>
        <section className="intro" aria-labelledby="page-title">
          <h1 id="page-title">Turn a website into a banner package</h1>
          <p className="lede">
            Paste the site&apos;s address. The packager opens it in a real browser, finds the logo and the photos, and crops them to
            every Google Ads Discovery and Remarketing size. Nothing is stretched, and nothing is filled in with placeholders.
          </p>
          {configError && (
            <p className="field-error" role="alert">
              {configError}
            </p>
          )}
          {config && form && (
            <BuildForm config={config} form={form} onChange={updateForm} onSubmit={() => submit(form)} submitting={submitting} error={submitError} />
          )}
        </section>

        {config && view && (
          <section className="mat" aria-label="Package">
            <div className="mat-inner">
              <StatusPanel config={config} jobState={jobState} onRebuild={rebuild} />
              <Sheet
                layout={config.layout}
                view={view}
                onOpen={setViewerItem}
                onRebuild={rebuild}
              />
            </div>
          </section>
        )}
      </main>

      <footer className="footer">
        {config && (
          <p>
            Runs website-image-packager {config.packagerVersion}. Packages are deleted {formatHours(config.jobTtlMinutes)} after they&apos;re
            built.
          </p>
        )}
        <p>
          Command-line version: <code>npm install -g website-image-packager</code>
        </p>
      </footer>

      <Viewer item={viewerItem} onClose={() => setViewerItem(null)} />
    </>
  );
}
