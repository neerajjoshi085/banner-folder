#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { Command, Option } = require('commander');
const pkg = require('../package.json');
const { packageWebsite, zipPackage, formatSummary, toJsonReport, createLogger } = require('../src');
const { formatBytes } = require('../src/utils');

const toInt = (v) => {
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n)) throw new Error(`not a number: ${v}`);
  return n;
};
const toFloat = (v) => {
  const n = Number.parseFloat(v);
  if (!Number.isFinite(n)) throw new Error(`not a number: ${v}`);
  return n;
};

function askYesNo(question) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return Promise.resolve(null);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(/^\s*y(es)?\s*$/i.test(answer));
    });
  });
}

async function run(opts) {
  const logger = createLogger({ level: opts.quiet ? 'warn' : opts.verbose ? 'debug' : 'info' });
  let result;
  try {
    result = await packageWebsite({
      url: opts.url,
      outDir: opts.out,
      imagesPerSize: opts.imagesPerSize,
      maxUpscale: opts.maxUpscale,
      crop: opts.crop,
      logo: opts.logo,
      logoBackground: opts.logoBg,
      gallery: opts.gallery,
      includeHero: opts.includeHero,
      maxGallery: opts.maxGallery,
      minGallerySize: opts.minGallerySize,
      mobilePass: opts.mobile,
      timeout: opts.timeout,
      browser: opts.browser,
      headed: opts.headed,
      force: opts.force,
      logger,
    });
  } catch (err) {
    logger.error(err.message);
    if (opts.verbose && err.stack) process.stderr.write(`${err.stack}\n`);
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`${formatSummary(result)}\n`);

  if (opts.report) {
    const file = path.resolve(opts.report);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(toJsonReport(result), null, 2));
    process.stdout.write(`Report written to ${file}\n`);
  }

  // Last step: ZIP (asked interactively unless --zip / --no-zip was given).
  let makeZip = opts.zip;
  if (makeZip === undefined) {
    const answer = await askYesNo(`\nCreate a ZIP of "${path.basename(result.outDir)}"? (y/N) `);
    if (answer === null) {
      process.stdout.write('\nNo ZIP created (non-interactive). Re-run with --zip to create one.\n');
      makeZip = false;
    } else {
      makeZip = answer;
    }
  }
  if (makeZip) {
    try {
      const zip = await zipPackage(result.outDir);
      process.stdout.write(`ZIP created: ${zip.path} (${formatBytes(zip.bytes)})\n`);
    } catch (err) {
      logger.error(`Could not create ZIP: ${err.message}`);
      process.exitCode = 1;
      return;
    }
  }

  process.exitCode = result.complete ? 0 : 2;
}

const program = new Command();
program
  .name('website-images')
  .description(pkg.description)
  .version(pkg.version, '-V, --version')
  .requiredOption('-u, --url <url>', 'website to extract images from')
  .option('-o, --out <dir>', 'output folder (default: ./<domain>)')
  .option('-n, --images-per-size <n>', 'images in every size folder', toInt, 4)
  .option('--max-upscale <factor>', 'largest enlargement allowed when cropping a photo to a banner size', toFloat, 1.5)
  .addOption(new Option('--crop <strategy>', 'smart-crop strategy').choices(['attention', 'entropy', 'center']).default('attention'))
  .option('--logo <file-or-url>', 'use this logo instead of auto-detecting it')
  .option('--logo-bg <color>', 'logo canvas background: white, transparent or #rrggbb', 'white')
  .option('--include-hero', 'also allow images from the hero section (excluded by default)')
  .option('--no-gallery', 'do not create the gallery folder')
  .option('--max-gallery <n>', 'maximum number of gallery images', toInt, 30)
  .option('--min-gallery-size <px>', 'minimum longest side for gallery photos', toInt, 800)
  .option('--no-mobile', 'skip the second scan in a mobile viewport')
  .option('--zip', 'create the ZIP without asking')
  .option('--no-zip', 'do not create a ZIP and do not ask')
  .option('--report <file>', 'also save a JSON report (sources, sizes, missing assets)')
  .option('--force', 'replace a package previously generated in the output folder')
  .option('--timeout <ms>', 'page load timeout in milliseconds', toInt, 60000)
  .addOption(new Option('--browser <channel>', 'use an installed browser instead of bundled Chromium').choices(['chrome', 'msedge', 'chromium']))
  .option('--headed', 'show the browser window (debugging)')
  .option('-v, --verbose', 'detailed progress output')
  .option('-q, --quiet', 'only print warnings, errors and the summary')
  .addHelpText(
    'after',
    `
Output (matches the reference banner package):
  logo.png (1200x300), logo-1.png (1200x1200), gallery/gallery-01.webp…,
  Discovery/{1200x1200,1200x628,960x1200}/image.png, image-1.png, image-2.png, image-3.png
  Remarketing/{1200x1200,1200x628,900x1600}/image.png, image-1.png, image-2.png, image-3.png

Exit codes: 0 complete, 2 created with missing assets, 1 error.

Example:
  website-images --url https://example.com --out ./project-name`,
  )
  .action(run);

program.parseAsync(process.argv).catch((err) => {
  process.stderr.write(`Error: ${err.message}\n`);
  process.exitCode = 1;
});
