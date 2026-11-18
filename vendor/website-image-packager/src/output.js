'use strict';

const fs = require('fs');
const path = require('path');
const { sizeKey } = require('./config');
const { PackagerError } = require('./errors');

const BANNER_FILE_RE = /^image(-\d+)?\.png$/;
const GALLERY_FILE_RE = /^gallery-\d{2,}\.webp$/;

function zipNameFor(outDir) {
  return `${path.basename(path.resolve(outDir))}.zip`;
}

/**
 * Classifies what already exists in the output folder:
 *  - generated:     files/folders this tool creates (safe to replace with --force)
 *  - foreign:       anything else inside the managed folders (never touched)
 *  - caseConflicts: e.g. a website's "discovery" folder vs our "Discovery"
 *                   (the same folder on Windows / macOS)
 */
function inspectOutputDir(outDir, layout) {
  const generated = [];
  const foreign = [];
  const caseConflicts = [];
  if (!fs.existsSync(outDir)) return { generated, foreign, caseConflicts };
  if (!fs.statSync(outDir).isDirectory()) throw new PackagerError(`--out exists and is not a folder: ${outDir}`);

  const managed = new Map();
  for (const logo of layout.logos) managed.set(logo.file.toLowerCase(), { name: logo.file, type: 'file' });
  for (const campaign of layout.campaigns) managed.set(campaign.name.toLowerCase(), { name: campaign.name, type: 'campaign', campaign });
  managed.set(layout.galleryDir.toLowerCase(), { name: layout.galleryDir, type: 'gallery' });
  managed.set(zipNameFor(outDir).toLowerCase(), { name: zipNameFor(outDir), type: 'file' });

  for (const entry of fs.readdirSync(outDir)) {
    const spec = managed.get(entry.toLowerCase());
    if (!spec) continue;
    const full = path.join(outDir, entry);
    if (entry !== spec.name) {
      caseConflicts.push(full);
      continue;
    }
    const stat = fs.statSync(full);
    if (spec.type === 'file') {
      (stat.isFile() ? generated : foreign).push(full);
      continue;
    }
    if (!stat.isDirectory()) {
      foreign.push(full);
      continue;
    }
    if (spec.type === 'gallery') {
      for (const f of fs.readdirSync(full)) {
        const p = path.join(full, f);
        (GALLERY_FILE_RE.test(f) && fs.statSync(p).isFile() ? generated : foreign).push(p);
      }
      generated.push(full);
      continue;
    }
    const sizes = new Set(spec.campaign.sizes.map(sizeKey));
    for (const d of fs.readdirSync(full)) {
      const p = path.join(full, d);
      if (!sizes.has(d) || !fs.statSync(p).isDirectory()) {
        foreign.push(p);
        continue;
      }
      for (const f of fs.readdirSync(p)) {
        const fp = path.join(p, f);
        (BANNER_FILE_RE.test(f) && fs.statSync(fp).isFile() ? generated : foreign).push(fp);
      }
      generated.push(p);
    }
    generated.push(full);
  }
  return { generated, foreign, caseConflicts };
}

/** Throws (without changing anything) if the folder cannot be used. */
function checkOutputDir(outDir, { force, layout }) {
  const { generated, foreign, caseConflicts } = inspectOutputDir(outDir, layout);
  if (caseConflicts.length) {
    throw new PackagerError(
      `The output folder already contains ${caseConflicts.map((p) => `"${path.basename(p)}"`).join(', ')}, ` +
        'which would collide with the package folder names (folder names are case-insensitive on Windows).\n' +
        'Choose a new or empty --out folder. Nothing was changed.',
      { code: 'E_OUTPUT' },
    );
  }
  if (foreign.length) {
    throw new PackagerError(
      `The output folder contains files this tool did not create:\n  ${foreign.slice(0, 10).join('\n  ')}` +
        `${foreign.length > 10 ? `\n  …and ${foreign.length - 10} more` : ''}\nChoose a new or empty --out folder. Nothing was changed.`,
      { code: 'E_OUTPUT' },
    );
  }
  const files = generated.filter((p) => fs.statSync(p).isFile());
  if (files.length && !force) {
    throw new PackagerError(
      `${outDir} already contains a generated package (${files.length} files).\n` +
        'Re-run with --force to replace it, or choose another --out folder.',
      { code: 'E_OUTPUT_EXISTS' },
    );
  }
  return { generated, files };
}

/** Removes a previous package (only files this tool creates) and creates the folder tree. */
function prepareOutputDir(outDir, { force, layout, gallery }) {
  const { generated, files } = checkOutputDir(outDir, { force, layout });
  for (const f of files) fs.unlinkSync(f);
  for (const d of generated.filter((p) => !files.includes(p))) {
    try {
      fs.rmdirSync(d);
    } catch {
      /* not empty or already gone – leave it */
    }
  }
  fs.mkdirSync(outDir, { recursive: true });
  for (const campaign of layout.campaigns) {
    for (const size of campaign.sizes) fs.mkdirSync(path.join(outDir, campaign.name, sizeKey(size)), { recursive: true });
  }
  if (gallery) fs.mkdirSync(path.join(outDir, layout.galleryDir), { recursive: true });
}

module.exports = { inspectOutputDir, checkOutputDir, prepareOutputDir, zipNameFor };
