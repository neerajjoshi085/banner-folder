'use strict';

/*
 * Downloads Playwright's Chromium after `npm install`. Never fails the install:
 * if the download is not possible, the tool falls back to an installed Chrome/Edge
 * at runtime, and the message below explains how to install Chromium later.
 */
const path = require('path');
const { spawnSync } = require('child_process');

if (process.env.WEBSITE_IMAGES_SKIP_BROWSER_DOWNLOAD || process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD) {
  console.log('website-image-packager: skipping Chromium download (env variable set).');
  process.exit(0);
}

let cli;
try {
  cli = path.join(path.dirname(require.resolve('playwright/package.json')), 'cli.js');
} catch {
  console.warn('website-image-packager: playwright not found; run "npx playwright install chromium" later.');
  process.exit(0);
}

const res = spawnSync(process.execPath, [cli, 'install', 'chromium'], { stdio: 'inherit' });
if (res.status !== 0) {
  console.warn(
    '\nwebsite-image-packager: could not download Chromium automatically.\n' +
      'Run "npx playwright install chromium" later, or use an installed browser with --browser chrome / --browser msedge.\n',
  );
}
process.exit(0);
