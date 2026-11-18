import { memo, useMemo, useState } from 'react';
import { fileUrl, thumbUrl } from '../api.js';
import {
  bannerFile, cx, dims, humanize, isWebUrl, parseSize, plural, ratioLabel, shapeLabel, shortUrl,
} from '../format.js';

const FOLDER_NOTE_RE = /^([A-Za-z]+\/\d+x\d+): ([\s\S]*)$/;

/** Attaches each "missing assets" message to the part of the sheet it describes. */
function sortNotes(result) {
  const notes = { folders: {}, logos: null, other: [] };
  if (!result) return notes;
  for (const raw of result.missing) {
    const text = humanize(raw);
    const folder = FOLDER_NOTE_RE.exec(text);
    if (folder) notes.folders[folder[1]] = folder[2];
    else if (text.startsWith('logo')) notes.logos = text.replace(/^logo\.png and logo-1\.png: /, '');
    else if (text.startsWith('gallery/')) continue;
    else notes.other.push(text);
  }
  return notes;
}

function SourceLink({ url }) {
  if (!isWebUrl(url)) return url || 'Unknown';
  return (
    <a href={url} target="_blank" rel="noopener noreferrer">
      {shortUrl(url, 80)}
    </a>
  );
}

function FadeImg({ src, alt = '' }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <img
      src={src}
      alt={alt}
      decoding="async"
      draggable={false}
      className={loaded ? 'is-loaded' : undefined}
      onLoad={() => setLoaded(true)}
    />
  );
}

function Frame({ width, height, name, state, src, checker, missingText, badge, openLabel, onOpen }) {
  const filled = state === 'filled' && src;
  return (
    <div className="frame-wrap" style={{ '--w': width, '--h': height }}>
      <div className={cx('frame', `is-${state}`, filled && checker && 'is-checker')}>
        {filled ? (
          <button type="button" className="frame-hit" onClick={onOpen} aria-label={openLabel}>
            <FadeImg key={src} src={src} />
          </button>
        ) : (
          <span className="frame-name">{name}</span>
        )}
        {state === 'missing' && <span className="frame-missing">{missingText}</span>}
        {filled && badge && (
          <span className="frame-badge" aria-hidden="true">
            {badge}
          </span>
        )}
      </div>
    </div>
  );
}

/* Logos ---------------------------------------------------------------------- */

function logoItem(jobId, spec, entry) {
  const facts = [['Size', `${dims(spec.width, spec.height)} px, PNG (${spec.label})`]];
  if (entry) {
    facts.push(['Source logo', entry.sourceType === 'vector (SVG)' ? 'Vector (SVG), drawn at full size' : `${dims(...parseSize(entry.sourceSize))} px raster`]);
    if (entry.upscale) facts.push(['Enlargement', entry.upscale > 1.005 ? `${entry.upscale.toFixed(1)}×` : 'None']);
    facts.push(['Background', entry.background]);
    facts.push(['Found at', <SourceLink key="src" url={entry.source} />]);
  }
  return {
    path: spec.file,
    src: fileUrl(jobId, spec.file),
    alt: `Logo, ${spec.label}`,
    checker: entry ? entry.background === 'transparent' : false,
    facts,
  };
}

function LogoSource({ result, onRebuild }) {
  const logo = result.logos[0];
  const alternatives = (result.logoAlternatives || []).filter(isWebUrl).slice(0, 4);
  let found = null;
  if (logo) {
    const how = logo.sourceType === 'vector (SVG)'
      ? 'a vector file, drawn at full size'
      : `${dims(...parseSize(logo.sourceSize))} px${logo.upscaleMax > 1.005 ? `, enlarged ${logo.upscaleMax.toFixed(1)}×` : ''}`;
    found = (
      <p className="group-detail">
        {logo.source === '(uploaded logo)' ? 'Made from your uploaded logo' : <>Made from <SourceLink url={logo.source} /></>} ({how}).
      </p>
    );
  }
  return (
    <>
      {found}
      {alternatives.length > 0 && (
        <div className="alternatives">
          <p className="group-detail">{logo ? 'Other logos found on the site:' : 'Possible logos found on the site:'}</p>
          <ul>
            {alternatives.map((url) => (
              <li key={url} className="alternative">
                <span className="alternative-image">
                  <img
                    src={url}
                    alt=""
                    referrerPolicy="no-referrer"
                    loading="lazy"
                    onError={(e) => {
                      e.currentTarget.style.visibility = 'hidden';
                    }}
                  />
                </span>
                <button type="button" className="button button-ghost button-small" onClick={() => onRebuild({ logoMode: 'url', logoUrl: url })}>
                  Rebuild with this logo
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

function LogoGroup({ layout, view, note, onOpen, onRebuild }) {
  const { result, jobId, status } = view;
  const background = result && result.logos[0] ? result.logos[0].background : view.logoBackground;
  const ref = Math.max(...layout.logos.map((l) => l.width));
  return (
    <section className="group" aria-labelledby="group-logos">
      <div className="group-head">
        <h3 id="group-logos" className="group-title">Logos</h3>
        <p className="group-note">Trimmed and centred on a {background === 'transparent' ? 'transparent' : background} canvas.</p>
      </div>
      {layout.logos.map((spec) => {
        const entry = result ? result.logos.find((l) => l.file === spec.file) : null;
        let state = status === 'running' || status === 'queued' ? 'waiting' : 'empty';
        if (result) state = entry ? 'filled' : 'missing';
        else if (view.logosReady && status === 'running') state = 'filled';
        return (
          <div key={spec.file} className="size-row">
            <div className="size-label">
              <span className="dims">{dims(spec.width, spec.height)}</span>
              <span className="size-meta">
                {shapeLabel(spec.width, spec.height)} {ratioLabel(spec.width, spec.height)}
              </span>
            </div>
            <div className="frames frames-logos" style={{ '--ref': ref }}>
              <Frame
                width={spec.width}
                height={spec.height}
                name={spec.file}
                state={state}
                src={jobId ? fileUrl(jobId, spec.file) : null}
                checker={background === 'transparent'}
                missingText="No logo found"
                openLabel={`Open ${spec.file}, ${spec.label} logo`}
                onOpen={() => onOpen(logoItem(jobId, spec, entry))}
              />
            </div>
          </div>
        );
      })}
      {(note || result) && (
        <div className="size-row">
          <div className="row-aside">
            {note && <p className="row-note">{note}</p>}
            {result && <LogoSource result={result} onRebuild={onRebuild} />}
          </div>
        </div>
      )}
    </section>
  );
}

/* Banners -------------------------------------------------------------------- */

function bannerItem(jobId, rel, size, entry, view) {
  const facts = [['Size', `${dims(size.width, size.height)} px, PNG`]];
  if (entry) {
    const where = entry.section === 'gallery' ? 'from the gallery section' : 'from another section of the page';
    facts.push(['Source photo', `${dims(...parseSize(entry.sourceSize))} px, ${where}`]);
    facts.push(['Enlargement', entry.scale > 1.005 ? `${entry.scale.toFixed(2)}×` : 'None']);
    facts.push(['Crop keeps', `${Math.round(entry.keptFraction * 100)}% of the photo`]);
    facts.push(['Found at', <SourceLink key="src" url={entry.source} />]);
  }
  return {
    path: rel,
    src: fileUrl(jobId, rel),
    alt: `${rel} banner`,
    facts,
  };
}

function bannerFrames(folder, key, view) {
  const banner = view.result ? view.result.banners.find((b) => b.folder === folder) : null;
  const ready = view.status === 'running' ? view.readySizes[key] : undefined;
  const count = banner ? banner.expected : view.perSize;
  return Array.from({ length: count }, (_, i) => {
    const file = bannerFile(i);
    const rel = `${folder}/${file}`;
    if (banner) return { file, rel, state: banner.files[i] ? 'filled' : 'missing', entry: banner.files[i] };
    if (ready !== undefined) return { file, rel, state: i < ready ? 'filled' : 'missing' };
    return { file, rel, state: view.status === 'running' || view.status === 'queued' ? 'waiting' : 'empty' };
  });
}

function SizeRow({ campaign, size, sharedWith, refWidth, view, note, onOpen }) {
  const key = `${size.width}x${size.height}`;
  const folder = `${campaign}/${key}`;
  const frames = bannerFrames(folder, key, view);
  const filled = frames.filter((f) => f.state === 'filled').length;
  const known = frames.some((f) => f.state === 'filled' || f.state === 'missing');
  return (
    <div className="size-row">
      <div className="size-label">
        <span className="dims">{dims(size.width, size.height)}</span>
        <span className="size-meta">
          {shapeLabel(size.width, size.height)} {ratioLabel(size.width, size.height)}
        </span>
        {sharedWith && <span className="size-meta">Same files as {sharedWith}</span>}
        {known && <span className={cx('size-count', filled < frames.length && 'is-short')}>{filled} of {frames.length}</span>}
      </div>
      <div className="frames" style={{ '--ref': refWidth }}>
        {frames.map((f) => {
          const badge = f.entry && f.entry.scale > 1.05 ? `${f.entry.scale.toFixed(1)}×` : null;
          return (
            <Frame
              key={f.rel}
              width={size.width}
              height={size.height}
              name={f.file}
              state={f.state}
              src={view.jobId ? thumbUrl(view.jobId, f.rel) : null}
              badge={badge}
              missingText="No suitable photo"
              openLabel={`Open ${f.rel}${badge ? `, enlarged ${badge}` : ''}`}
              onOpen={() => onOpen(bannerItem(view.jobId, f.rel, size, f.entry, view))}
            />
          );
        })}
      </div>
      {note && <p className="row-note">{note}</p>}
    </div>
  );
}

function CampaignGroup({ campaign, earlier, refWidth, view, notes, onOpen }) {
  const groupId = `group-${campaign.name.toLowerCase()}`;
  return (
    <section className="group" aria-labelledby={groupId}>
      <div className="group-head">
        <h3 id={groupId} className="group-title">{campaign.name}</h3>
        <p className="group-note">
          {plural(campaign.sizes.length, 'size', 'sizes')}, {plural(view.perSize, 'PNG', 'PNGs')} in each
        </p>
      </div>
      {campaign.sizes.map((size) => {
        const sharedWith = earlier.find((c) => c.sizes.some((s) => s.width === size.width && s.height === size.height));
        const folder = `${campaign.name}/${size.width}x${size.height}`;
        return (
          <SizeRow
            key={folder}
            campaign={campaign.name}
            size={size}
            sharedWith={sharedWith && sharedWith.name}
            refWidth={refWidth}
            view={view}
            note={notes.folders[folder]}
            onOpen={onOpen}
          />
        );
      })}
    </section>
  );
}

/* Sheet ---------------------------------------------------------------------- */

export const Sheet = memo(function Sheet({ layout, view, onOpen, onRebuild }) {
  const notes = useMemo(() => sortNotes(view.result), [view.result]);
  const bannerRef = Math.max(...layout.campaigns.flatMap((c) => c.sizes.map((s) => s.width)));
  return (
    <div className="sheet">
      <LogoGroup layout={layout} view={view} note={notes.logos} onOpen={onOpen} onRebuild={onRebuild} />
      {layout.campaigns.map((campaign, i) => (
        <CampaignGroup
          key={campaign.name}
          campaign={campaign}
          earlier={layout.campaigns.slice(0, i)}
          refWidth={bannerRef}
          view={view}
          notes={notes}
          onOpen={onOpen}
        />
      ))}
      {notes.other.length > 0 && (
        <ul className="other-notes">
          {notes.other.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </div>
  );
});
