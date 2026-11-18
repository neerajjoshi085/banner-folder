'use strict';

const fs = require('fs');
const path = require('path');
const yazl = require('yazl');
const { zipNameFor } = require('./output');

// Already-compressed formats are stored as-is (deflating them only costs time).
const STORE_RE = /\.(png|jpe?g|webp|avif|gif|zip)$/i;

function walk(dir, rel = '') {
  const out = [];
  const entries = fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const e of entries) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) {
      out.push({ rel: r, dir: true });
      out.push(...walk(dir, r));
    } else if (e.isFile()) {
      out.push({ rel: r, dir: false });
    }
  }
  return out;
}

/**
 * Zips the *contents* of srcDir (no wrapper folder – same layout as the reference
 * banner ZIPs, including explicit folder entries). A ZIP placed inside srcDir
 * excludes itself.
 */
async function zipDirectory(srcDir, zipPath) {
  const dir = path.resolve(srcDir);
  const target = path.resolve(zipPath);
  const partial = `${target}.partial`;
  const exclude = new Set([target, partial].map((p) => path.relative(dir, p).split(path.sep).join('/')));

  const zip = new yazl.ZipFile();
  for (const entry of walk(dir)) {
    if (exclude.has(entry.rel) || entry.rel.startsWith('.')) continue;
    if (entry.dir) zip.addEmptyDirectory(entry.rel);
    else zip.addFile(path.join(dir, entry.rel), entry.rel, { compress: !STORE_RE.test(entry.rel) });
  }
  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(partial);
    output.on('close', resolve);
    output.on('error', reject);
    zip.outputStream.on('error', reject);
    zip.outputStream.pipe(output);
    zip.end();
  });
  await fs.promises.rename(partial, target);
  const { size } = await fs.promises.stat(target);
  return { path: target, bytes: size };
}

/** Creates <outDir>/<folder-name>.zip, like the reference packages. */
async function zipPackage(outDir) {
  const dir = path.resolve(outDir);
  return zipDirectory(dir, path.join(dir, zipNameFor(dir)));
}

module.exports = { zipDirectory, zipPackage };
