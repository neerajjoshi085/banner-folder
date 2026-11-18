import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import packager from 'website-image-packager';
import {
  createRequestParser, DEFAULT_MAX_UPSCALE, DEFAULT_MOBILE_PASS, DEFAULT_TIMEOUT_SECONDS, isPrivateAddress, LIMITS,
  normalizeUrl, packageName,
} from '../server/validate.js';
import { resolveFile } from '../server/api.js';
import packagerSelect from '../vendor/website-image-packager/src/select.js';

const publicLookup = async () => [{ address: '93.184.215.14', family: 4 }];
const privateLookup = async () => [{ address: '93.184.215.14', family: 4 }, { address: '10.0.0.8', family: 4 }];
const tinyPng = `data:image/png;base64,${Buffer.from('fake image bytes').toString('base64')}`;

test('private, loopback and link-local addresses are blocked', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.5.4', '192.168.1.1', '169.254.169.254', '0.0.0.0', '100.64.0.1',
    '::1', '::', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:a9fe:a9fe', 'not-an-ip']) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '93.184.215.14', '2606:4700:4700::1111', '::ffff:8.8.8.8']) {
    assert.equal(isPrivateAddress(ip), false, ip);
  }
});

test('addresses are normalised like the CLI does', () => {
  assert.equal(normalizeUrl('example.com').href, 'https://example.com/');
  assert.equal(normalizeUrl(' http://example.com/a#top ').href, 'http://example.com/a');
  assert.throws(() => normalizeUrl(''), /Enter the website address/);
  assert.throws(() => normalizeUrl('ftp://example.com'), /Only http/);
  assert.throws(() => normalizeUrl('https://user:pw@example.com'), /user name and password/);
  assert.throws(() => normalizeUrl('intranet'), /not a full domain name/);
});

test('package names are safe folder names', () => {
  const url = new URL('https://www.example.com/page');
  assert.equal(packageName('', url), 'example.com');
  assert.equal(packageName('My Project!', url), 'My-Project');
  assert.equal(packageName('../../etc', url), 'etc');
  assert.equal(packageName('con', url), 'con-package');
  assert.throws(() => packageName('***', url), /package name/);
});

test('all supported banner sizes are exposed', () => {
  const layout = packager.LAYOUT;
  assert.deepEqual(layout.logos.map((logo) => `${logo.width}x${logo.height}`), ['1200x300', '1200x1200']);
  assert.deepEqual(layout.campaigns.map((campaign) => campaign.sizes.map((size) => `${size.width}x${size.height}`)), [
    ['1200x1200', '1200x628', '960x1200'],
    ['1200x1200', '1200x628', '900x1600'],
  ]);
});

test('packager accepts the high enlargement limit without launching a browser', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'website-image-packager-test-'));
  const outDir = path.join(dir, 'not-a-folder');
  await fs.writeFile(outDir, 'occupied');
  try {
    await assert.rejects(
      packager.packageWebsite({ url: 'https://example.com', outDir, maxUpscale: 10000 }),
      /exists and is not a folder/,
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('a visible image linked home in the header is a logo candidate without logo keywords', () => {
  const headerBrand = {
    animated: false,
    selfText: 'images/brand.webp',
    ctxText: '',
    inHeader: true,
    homeLink: true,
    visible: true,
    width: 300,
    height: 100,
    minY: 20,
    sources: new Set(['img']),
    transparentFrac: 0,
    inFooter: false,
    isPhoto: false,
    isLight: true,
    order: 0,
  };
  assert.equal(packagerSelect.rankLogos([headerBrand]).length, 1);
});

test('a request becomes packageWebsite() options with defaults', async () => {
  const parse = createRequestParser({ lookup: publicLookup });
  const defaults = await parse({ url: 'example.com' });
  assert.equal(defaults.options.maxUpscale, DEFAULT_MAX_UPSCALE);
  assert.equal(defaults.options.mobilePass, DEFAULT_MOBILE_PASS);
  assert.equal(defaults.options.timeout, DEFAULT_TIMEOUT_SECONDS * 1000);

  const spec = await parse({ url: 'example.com', imagesPerSize: '3', maxUpscale: 2, includeHero: true, gallery: true });
  assert.equal(spec.url, 'https://example.com/');
  assert.equal(spec.name, 'example.com');
  assert.equal(spec.logo, null);
  assert.deepEqual(spec.options, {
    imagesPerSize: 3,
    maxUpscale: 2,
    crop: 'attention',
    logoBackground: 'white',
    includeHero: true,
    gallery: false,
    mobilePass: false,
    timeout: 30000,
    requestTimeout: 15000,
  });
});

test('hosts that resolve to a private address are refused', async () => {
  const parse = createRequestParser({ lookup: privateLookup });
  await assert.rejects(parse({ url: 'example.com' }), /private network address/);
  await assert.rejects(createRequestParser({ lookup: publicLookup })({ url: 'http://[::1]:3000/' }), /private network/);
  const allowed = createRequestParser({ lookup: privateLookup, allowPrivateUrls: true });
  assert.equal((await allowed({ url: 'example.com' })).url, 'https://example.com/');
});

test('out-of-range options name the field', async () => {
  const parse = createRequestParser({ lookup: publicLookup });
  await assert.rejects(parse({ url: 'example.com', imagesPerSize: 0 }), (err) => err.field === 'imagesPerSize');
  await assert.rejects(parse({ url: 'example.com', maxUpscale: LIMITS.maxUpscale[1] + 1 }), (err) => err.field === 'maxUpscale');
  await assert.rejects(parse({ url: 'example.com', crop: 'smart' }), (err) => err.field === 'crop');
  await assert.rejects(parse({ url: 'example.com', logoBackground: 'red' }), (err) => err.field === 'logoBackground');
});

test('logos: URL, upload, reuse – never a local file path', async () => {
  const previous = { logo: { mode: 'upload', value: tinyPng, name: 'brand.png' } };
  const parse = createRequestParser({ lookup: publicLookup, findJob: (id) => (id === 'job-1' ? previous : null) });

  const byUrl = await parse({ url: 'example.com', logoMode: 'url', logoUrl: 'cdn.example.com/logo.svg' });
  assert.equal(byUrl.logo.value, 'https://cdn.example.com/logo.svg');

  const uploaded = await parse({ url: 'example.com', logoMode: 'upload', logoData: tinyPng, logoName: 'brand.png' });
  assert.equal(uploaded.logo.value, tinyPng);

  const reused = await parse({ url: 'example.com', logoMode: 'upload', reuseLogoFrom: 'job-1' });
  assert.equal(reused.logo, previous.logo);

  await assert.rejects(parse({ url: 'example.com', logoMode: 'upload', logoData: 'C:\\secret.png' }), /Choose a PNG/);
  await assert.rejects(parse({ url: 'example.com', logoMode: 'url', logoUrl: 'file:///etc/passwd' }), /Only http/);
  await assert.rejects(parse({ url: 'example.com', logoMode: 'upload', reuseLogoFrom: 'gone' }), /expired/);
});

test('file routes only reach package images inside the job folder', () => {
  const root = path.resolve('jobs', 'abc', 'example.com');
  assert.equal(resolveFile(root, ['Discovery', '1200x628', 'image-1.png']).rel, 'Discovery/1200x628/image-1.png');
  assert.equal(resolveFile(root, ['gallery', 'gallery-01.webp']).full, path.join(root, 'gallery', 'gallery-01.webp'));
  for (const bad of [['..', 'secret.png'], ['C:', 'Windows', 'a.png'], ['a\\..\\..\\b.png'], ['.thumbs', 'a.webp'], ['report.json'], []]) {
    assert.equal(resolveFile(root, bad), null, JSON.stringify(bad));
  }
});
