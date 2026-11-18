import { useEffect, useId, useState } from 'react';
import { OPTION_FIELDS, changedCount } from '../form.js';
import { formatBytes, hostOf } from '../format.js';

const MAX_LOGO_BYTES = 8 * 1024 * 1024;
/** Fields that show their own error message; errors for any other field appear under the form. */
const FIELDS_WITH_ERRORS = [
  'url', 'name', 'imagesPerSize', 'maxUpscale', 'logoUrl', 'logoData', 'logoBackground', 'timeoutSeconds',
];

const CROP_CHOICES = [
  { value: 'attention', label: 'Attention', hint: 'Follows skin tones, strong colour and bright detail.' },
  { value: 'entropy', label: 'Entropy', hint: 'Keeps the most detailed part of the photo.' },
  { value: 'center', label: 'Centre', hint: 'Crops evenly from the middle.' },
];

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function FieldError({ id, message }) {
  return message ? (
    <p id={id} className="field-error">
      {message}
    </p>
  ) : null;
}

function NumberField({ id, label, hint, unit, error, ...input }) {
  const describedBy = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ') || undefined;
  return (
    <div className="field">
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      <div className="number-row">
        <input id={id} className="input input-number" type="number" inputMode="numeric" aria-invalid={!!error} aria-describedby={describedBy} {...input} />
        {unit && <span className="unit">{unit}</span>}
      </div>
      {hint && (
        <p id={`${id}-hint`} className="hint">
          {hint}
        </p>
      )}
      <FieldError id={`${id}-error`} message={error} />
    </div>
  );
}

function Check({ id, type = 'checkbox', label, hint, ...input }) {
  return (
    <div className="check">
      <input id={id} type={type} aria-describedby={hint ? `${id}-hint` : undefined} {...input} />
      <div>
        <label htmlFor={id}>{label}</label>
        {hint && (
          <p id={`${id}-hint`} className="hint">
            {hint}
          </p>
        )}
      </div>
    </div>
  );
}

export function BuildForm({ config, form, onChange, onSubmit, submitting, error }) {
  const uid = useId();
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [localError, setLocalError] = useState(null);
  const shown = localError || error;
  const errorFor = (field) => (shown && shown.field === field ? shown.message : null);
  const generalError = shown && !FIELDS_WITH_ERRORS.includes(shown.field) ? shown.message : null;
  const changed = changedCount(config, form);
  const { limits } = config;
  const id = (name) => `${uid}-${name}`;

  useEffect(() => {
    if (error && OPTION_FIELDS.includes(error.field)) setOptionsOpen(true);
  }, [error]);

  const update = (patch) => {
    setLocalError(null);
    onChange(patch);
  };
  const set = (key) => (e) => update({ [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  async function pickLogo(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (file.size > MAX_LOGO_BYTES) {
      e.target.value = '';
      setLocalError({ field: 'logoData', message: `${file.name} is ${formatBytes(file.size)}. Use a logo file under 8 MB.` });
      return;
    }
    try {
      update({ logoFile: { name: file.name, size: file.size, dataUrl: await readAsDataUrl(file) }, reuseLogoFrom: null });
    } catch {
      setLocalError({ field: 'logoData', message: `Couldn't read ${file.name}. Choose the file again.` });
    }
  }

  function submit(e) {
    e.preventDefault();
    let problem = null;
    if (!String(form.url).trim()) problem = { field: 'url', message: 'Enter the website address.' };
    else if (form.logoMode === 'url' && !String(form.logoUrl).trim()) {
      problem = { field: 'logoUrl', message: 'Enter the address of the logo image.' };
    } else if (form.logoMode === 'upload' && !form.logoFile && !form.reuseLogoFrom) {
      problem = { field: 'logoData', message: 'Choose a logo file, or let the packager find the logo on the site.' };
    }
    if (problem) {
      setLocalError(problem);
      if (OPTION_FIELDS.includes(problem.field)) setOptionsOpen(true);
      return;
    }
    setLocalError(null);
    onSubmit();
  }

  const urlHost = String(form.url).trim() ? hostOf(/^https?:\/\//i.test(form.url) ? form.url : `https://${form.url.trim()}`) : '';

  return (
    <form className="build" onSubmit={submit} noValidate>
      <div className="field">
        <label htmlFor={id('url')} className="field-label field-label-lead">
          Website address
        </label>
        <div className="url-row">
          <input
            id={id('url')}
            className="input input-url"
            type="text"
            inputMode="url"
            autoComplete="url"
            autoCapitalize="off"
            spellCheck={false}
            placeholder="example.com"
            value={form.url}
            onChange={set('url')}
            aria-invalid={!!errorFor('url')}
            aria-describedby={errorFor('url') ? id('url-error') : undefined}
          />
          <button type="submit" className="button button-primary" disabled={submitting}>
            {submitting ? 'Starting…' : 'Build package'}
          </button>
        </div>
        <FieldError id={id('url-error')} message={errorFor('url')} />
      </div>

      <div className="field field-name">
        <label htmlFor={id('name')} className="field-label">
          Package name <span className="optional">(optional)</span>
        </label>
        <input
          id={id('name')}
          className="input"
          type="text"
          autoCapitalize="off"
          spellCheck={false}
          placeholder={urlHost || 'example.com'}
          value={form.name}
          onChange={set('name')}
          aria-describedby={id('name-hint')}
          aria-invalid={!!errorFor('name')}
        />
        <p id={id('name-hint')} className="hint">
          Names the folder and the ZIP file. Leave it empty to use the domain.
        </p>
        <FieldError message={errorFor('name')} />
      </div>

      <details className="options" open={optionsOpen} onToggle={(e) => setOptionsOpen(e.currentTarget.open)}>
        <summary>
          More options
          {changed > 0 && <span className="changed">{changed} changed</span>}
        </summary>

        <div className="options-grid">
          <fieldset className="option-set">
            <legend>Banners</legend>
            <NumberField
              id={id('per-size')}
              label="Images per size"
              hint="How many images go in each size folder."
              min={limits.imagesPerSize[0]}
              max={limits.imagesPerSize[1]}
              step={1}
              value={form.imagesPerSize}
              onChange={set('imagesPerSize')}
              error={errorFor('imagesPerSize')}
            />
            <div className="field">
              <label htmlFor={id('upscale')} className="field-label">
                Maximum enlargement{' '}
                <output htmlFor={id('upscale')} className="range-value">
                  {Number(form.maxUpscale) >= limits.maxUpscale[1] ? 'As needed' : `${Number(form.maxUpscale)}×`}
                </output>
              </label>
              <input
                id={id('upscale')}
                className="range"
                type="range"
                min={limits.maxUpscale[0]}
                max={limits.maxUpscale[1]}
                step={0.25}
                value={form.maxUpscale}
                onChange={set('maxUpscale')}
                aria-describedby={id('upscale-hint')}
              />
              <div className="range-ends" aria-hidden="true">
                <span>Sharper</span>
                <span>More photos qualify</span>
              </div>
              <p id={id('upscale-hint')} className="hint">
                Higher values let smaller photos qualify but may make them look softer. The default allows enlargement as needed.
              </p>
              <FieldError message={errorFor('maxUpscale')} />
            </div>
            <fieldset className="choice-group">
              <legend className="field-label">Crop focus</legend>
              {CROP_CHOICES.map((c) => (
                <Check
                  key={c.value}
                  id={id(`crop-${c.value}`)}
                  type="radio"
                  name={id('crop')}
                  value={c.value}
                  checked={form.crop === c.value}
                  onChange={set('crop')}
                  label={c.label}
                  hint={c.hint}
                />
              ))}
            </fieldset>
          </fieldset>

          <fieldset className="option-set">
            <legend>Logo</legend>
            <fieldset className="choice-group">
              <legend className="field-label">Where the logo comes from</legend>
              <Check id={id('logo-auto')} type="radio" name={id('logo')} value="auto" checked={form.logoMode === 'auto'} onChange={set('logoMode')} label="Find it on the site" />
              <Check id={id('logo-url')} type="radio" name={id('logo')} value="url" checked={form.logoMode === 'url'} onChange={set('logoMode')} label="Use an image address" />
              {form.logoMode === 'url' && (
                <div className="nested">
                  <input
                    className="input"
                    type="text"
                    inputMode="url"
                    autoCapitalize="off"
                    spellCheck={false}
                    placeholder="https://example.com/logo.svg"
                    aria-label="Logo image address"
                    value={form.logoUrl}
                    onChange={set('logoUrl')}
                    aria-invalid={!!errorFor('logoUrl')}
                  />
                  <FieldError message={errorFor('logoUrl')} />
                </div>
              )}
              <Check id={id('logo-upload')} type="radio" name={id('logo')} value="upload" checked={form.logoMode === 'upload'} onChange={set('logoMode')} label="Upload a file" />
              {form.logoMode === 'upload' && (
                <div className="nested">
                  <input
                    className="file"
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif,image/avif,image/svg+xml"
                    aria-label="Logo file"
                    aria-describedby={id('logo-file-hint')}
                    onChange={pickLogo}
                  />
                  <p id={id('logo-file-hint')} className="hint">
                    {form.logoFile
                      ? `${form.logoFile.name}, ${formatBytes(form.logoFile.size)}`
                      : form.reuseLogoFrom
                        ? `Using ${form.reuseLogoName || 'the logo'} from the last build. Choose a file to replace it.`
                        : 'PNG, JPEG, WebP, GIF, AVIF or SVG, up to 8 MB. SVG gives the sharpest result.'}
                  </p>
                  <FieldError message={errorFor('logoData')} />
                </div>
              )}
            </fieldset>
            <fieldset className="choice-group choice-row">
              <legend className="field-label">Logo background</legend>
              <Check id={id('bg-white')} type="radio" name={id('bg')} value="white" checked={form.logoBgMode === 'white'} onChange={set('logoBgMode')} label="White" />
              <Check id={id('bg-transparent')} type="radio" name={id('bg')} value="transparent" checked={form.logoBgMode === 'transparent'} onChange={set('logoBgMode')} label="Transparent" />
              <Check id={id('bg-color')} type="radio" name={id('bg')} value="color" checked={form.logoBgMode === 'color'} onChange={set('logoBgMode')} label="Colour" />
              <input
                type="color"
                className="color"
                aria-label="Logo background colour"
                value={form.logoBgColor}
                onChange={(e) => update({ logoBgColor: e.target.value, logoBgMode: 'color' })}
              />
              <FieldError message={errorFor('logoBackground')} />
            </fieldset>
          </fieldset>

          <fieldset className="option-set">
            <legend>Photos</legend>
            <Check
              id={id('hero')}
              label="Use hero images"
              hint="Also take photos from the large banner at the top of the page. They're left out by default."
              checked={form.includeHero}
              onChange={set('includeHero')}
            />
            <Check
              id={id('mobile')}
              label="Scan the phone layout too"
              hint="Opens the page a second time at phone size to find images that only show there."
              checked={form.mobilePass}
              onChange={set('mobilePass')}
            />
            <NumberField
              id={id('timeout')}
              label="Page load timeout"
              unit="seconds"
              min={limits.timeoutSeconds[0]}
              max={limits.timeoutSeconds[1]}
              value={form.timeoutSeconds}
              onChange={set('timeoutSeconds')}
              error={errorFor('timeoutSeconds')}
            />
          </fieldset>

        </div>
      </details>

      {generalError && (
        <p className="field-error form-error" role="alert">
          {generalError}
        </p>
      )}
    </form>
  );
}
