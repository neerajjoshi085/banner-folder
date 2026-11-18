'use strict';

const { displayUrl } = require('./utils');

const OK = '[ok]  ';
const MISS = '[!!]  ';

function pad(text, width) {
  return String(text).padEnd(width);
}

/** "(3 from gallery + 1 from other sections)" */
function sectionMix(files) {
  if (!files.length) return '';
  const g = files.filter((f) => f.section === 'gallery').length;
  const o = files.length - g;
  if (!o) return '(all from gallery section)';
  if (!g) return '(from other sections - gallery had none suitable)';
  return `(${g} from gallery + ${o} from other sections)`;
}

/** Human-readable summary of a packageWebsite() result. */
function formatSummary(result) {
  const lines = [];
  lines.push('');
  lines.push(`Package : ${result.outDir}`);
  lines.push(`Website : ${result.finalUrl || result.url}${result.pageTitle ? `  ("${result.pageTitle}")` : ''}`);
  lines.push('');

  lines.push('Logos');
  if (result.logos.length) {
    const src = result.logos[0];
    for (const l of result.logos) lines.push(`  ${OK}${pad(l.file, 12)} ${l.width}x${l.height}`);
    const how = src.sourceType === 'vector (SVG)' ? 'vector, rendered losslessly' : `${src.sourceSize} px, enlarged ${src.upscaleMax.toFixed(1)}x`;
    lines.push(`        source: ${displayUrl(src.source)} (${how})`);
  } else {
    lines.push(`  ${MISS}logo.png, logo-1.png  NOT CREATED`);
  }
  if (result.logoAlternatives && result.logoAlternatives.length) {
    lines.push('        other logos found (use one with --logo <url>):');
    for (const alt of result.logoAlternatives.slice(0, 3)) lines.push(`          ${alt}`);
  }

  let currentCampaign = '';
  for (const b of result.banners) {
    const [campaign, size] = b.folder.split('/');
    if (campaign !== currentCampaign) {
      lines.push(campaign);
      currentCampaign = campaign;
    }
    const mark = b.files.length >= b.expected ? OK : MISS;
    lines.push(`  ${mark}${pad(size, 10)} ${pad(`${b.files.length}/${b.expected} images`, 12)} ${sectionMix(b.files)}`);
  }

  if (result.galleryEnabled) {
    lines.push('Gallery');
    if (result.gallery.length) {
      const last = result.gallery[result.gallery.length - 1].file;
      lines.push(`  ${OK}${result.gallery.length} images (gallery-01.webp … ${last}) ${sectionMix(result.gallery)}`);
    } else {
      lines.push(`  ${MISS}no gallery images`);
    }
  }
  if (result.heroExcluded && result.heroExcluded.length) {
    lines.push(`Hero section images excluded (${result.heroExcluded.length}):`);
    for (const h of result.heroExcluded.slice(0, 4)) lines.push(`        ${h}`);
  }

  const s = result.stats || {};
  lines.push('');
  lines.push(
    `Scanned ${s.references || 0} image references: ${s.valid || 0} valid, ${s.duplicatesRemoved || 0} duplicates removed, ` +
      `${(s.broken || 0) + (s.unsupported || 0) + (s.downloadFailed || 0)} broken/unreachable, ` +
      `${s.photos || 0} usable photos, ${s.lowResolution || 0} photos too small, ${s.graphics || 0} icons/graphics/plans skipped.`,
  );

  if (result.missing.length) {
    lines.push('');
    lines.push('MISSING ASSETS');
    for (const m of result.missing) lines.push(`  - ${m}`);
  }
  if (result.warnings.length) {
    lines.push('');
    lines.push('Warnings');
    for (const w of result.warnings) lines.push(`  - ${w}`);
  }
  lines.push('');
  lines.push(result.complete ? 'Package complete.' : 'Package created with missing assets (see above).');
  return lines.join('\n');
}

/** JSON-safe copy of the result (for --report). */
function toJsonReport(result) {
  return JSON.parse(JSON.stringify(result, (key, value) => (typeof value === 'bigint' ? value.toString(16) : value)));
}

module.exports = { formatSummary, toJsonReport };
