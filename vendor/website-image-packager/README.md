# website-image-packager

Turn any website into a ready-to-upload **Discovery / Remarketing banner package**.

Give it a URL. It opens the site in a real headless browser (so JavaScript-rendered pages, sliders and lazy-loaded images work), collects the logo and photos, throws away duplicates, broken files, icons, floor plans and low-resolution images, and writes every banner size at the exact pixel dimensions, smart-cropped, never stretched.

Everything runs locally with free, open-source libraries ([Playwright](https://playwright.dev) + [Sharp](https://sharp.pixelplumbing.com)). No paid APIs, no AI credits.

```bash
website-images --url https://example.com --out ./project-name
```

---

## Output

The layout reproduces the reference banner package (`Banner.zip`) exactly:

```text
project-name/
├── logo.png                 1200×300   landscape logo (4:1), centred on white
├── logo-1.png               1200×1200  square logo (1:1), centred on white
├── gallery/
│   ├── gallery-01.webp      full-resolution site photos
│   ├── gallery-02.webp
│   └── …
├── Discovery/
│   ├── 1200x1200/           image.png  image-1.png  image-2.png  image-3.png
│   ├── 1200x628/            image.png  image-1.png  image-2.png  image-3.png
│   └── 960x1200/            image.png  image-1.png  image-2.png  image-3.png
└── Remarketing/
    ├── 1200x1200/           identical to Discovery/1200x1200
    ├── 1200x628/            identical to Discovery/1200x628
    └── 900x1600/            image.png  image-1.png  image-2.png  image-3.png
```

* Banners are PNG files, 4 per size folder, at exactly the folder's dimensions.
* Sizes shared by both campaigns (1200×1200, 1200×628) are byte-identical copies, as in the reference.
* Both logo files contain the same logo, trimmed and centred on a white canvas covering ~66% of the width, matching the reference logos.
* `gallery/` is added on top of the reference layout. Existing WebP files are copied byte-for-byte; other formats are converted to WebP at quality 90, full resolution.
* The optional ZIP (`project-name/project-name.zip`) contains the folder *contents* with no wrapper folder, like the reference ZIPs.

**No placeholders are ever generated.** If the site doesn't have enough suitable images, the folder is left short and the run ends with a **MISSING ASSETS** list that says exactly what's missing and why.

### Where the photos come from

1. **Gallery section first.** Banners and `gallery/` use photos from the website's gallery section: a container named *gallery*/*portfolio*, a lightbox gallery group, or a section headed "Gallery".
2. **Other sections only to top up.** If a size folder can't be filled with 4 gallery photos, the remaining slots are filled from other sections (overview, amenities, …). `gallery/` is topped up the same way, but only when the gallery section has fewer than 4 photos.
3. **Never the hero section.** Hero/banner images at the top of the page are excluded, together with their mobile and other-size variants. They're listed in the summary. Use `--include-hero` to allow them.

The summary shows the mix per folder, e.g. `4/4 images (3 from gallery + 1 from other sections)`.

---

## Install

Requires **Node.js 20 or newer**.

```bash
# from the package folder
npm install
npm link            # makes the `website-images` command available everywhere

# or install the packed tarball globally
npm install -g ./website-image-packager-1.0.0.tgz
```

`npm install` downloads Playwright's Chromium automatically. If that download isn't possible (offline or proxy), the tool falls back to an installed **Microsoft Edge** or **Google Chrome**. You can also install Chromium later with `npx playwright install chromium`.

Set `WEBSITE_IMAGES_SKIP_BROWSER_DOWNLOAD=1` to skip the download during install.

---

## Usage

```bash
website-images --url https://example.com --out ./project-name
```

After the folder has been created, the tool asks:

```text
Create a ZIP of "project-name"? (y/N)
```

Pass `--zip` to create it without asking, or `--no-zip` to skip the question (useful in scripts).

### Options

| Option | Default | Description |
| --- | --- | --- |
| `-u, --url <url>` | *required* | Website to extract from (`https://` is added if missing). |
| `-o, --out <dir>` | `./<domain>` | Output folder. |
| `-n, --images-per-size <n>` | `4` | Images in every size folder. |
| `--max-upscale <factor>` | `1.5` | Largest enlargement allowed to reach a banner size. Lower = sharper but may leave folders short; `2` accepts softer images. |
| `--crop <strategy>` | `attention` | `attention` (salient subject), `entropy` (busiest region) or `center`. |
| `--logo <file-or-url>` | auto | Use this logo instead of auto-detection. |
| `--logo-bg <color>` | `white` | Logo canvas: `white`, `transparent` or `#rrggbb`. |
| `--include-hero` | off | Also allow hero-section images (as "other section" photos). |
| `--no-gallery` | | Don't create `gallery/`. |
| `--max-gallery <n>` | `30` | Maximum gallery images. |
| `--min-gallery-size <px>` | `800` | Minimum longest side of a gallery photo (the shortest side must be ≥ 56% of this). |
| `--no-mobile` | | Skip the second scan in a mobile viewport (faster, but may miss mobile-only images). |
| `--zip` / `--no-zip` | ask | Create the ZIP without asking / never create it. |
| `--report <file>` | | Save a JSON report: source URL of every file, sizes, enlargement factors, missing assets. |
| `--force` | | Replace a package previously generated in the same folder. |
| `--timeout <ms>` | `60000` | Page-load timeout. |
| `--browser <channel>` | bundled | `chrome` or `msedge` to use an installed browser. |
| `--headed` | | Show the browser window (debugging). |
| `-v, --verbose` / `-q, --quiet` | | More / less output. |

### Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Package complete. |
| `2` | Package created, but some assets are missing (listed in the output). |
| `1` | Error (bad URL, site unreachable, unusable output folder, …). |

### Example output

```text
Logos
  [ok]  logo.png     1200x300
  [ok]  logo-1.png   1200x1200
        source: https://example.com/images/logo.png (365x175 px, enlarged 6.5x)
        other logos found (use one with --logo <url>):
          https://example.com/images/branding/project-logo.png
Discovery
  [ok]  1200x1200  4/4 images   (3 from gallery + 1 from other sections)
  [ok]  1200x628   4/4 images   (all from gallery section)
  [ok]  960x1200   4/4 images   (3 from gallery + 1 from other sections)
Remarketing
  [ok]  1200x1200  4/4 images   (3 from gallery + 1 from other sections)
  [ok]  1200x628   4/4 images   (all from gallery section)
  [!!]  900x1600   1/4 images   (all from gallery section)
Gallery
  [ok]  5 images (gallery-01.webp … gallery-05.webp) (all from gallery section)
Hero section images excluded (2):
        https://example.com/images/hero/banner.webp
        https://example.com/images/hero/banner-mob.webp

MISSING ASSETS
  - Remarketing/900x1600: 1 of 4 images. Only 1 of the site's 12 distinct usable photo(s) (gallery + other
    sections, hero section excluded) can be cropped to 900x1600 without enlarging more than 1.5x
    (a source needs at least 600x1067px).
```

---

## How it works

1. **Render.** Playwright loads the page in a desktop viewport (1440×900 at 2× pixel density, so `srcset` resolves to high-resolution files), then again in a mobile viewport. Each time it scrolls the whole page so lazy loaders, sliders and backgrounds fire.
2. **Collect.** It gathers every image reference:
   * `<img>` `src`, `currentSrc`, the largest `srcset` entry, and lazy attributes (`data-src`, `data-srcset`, `data-lazy`, `data-original`, …);
   * `<picture><source>` art-direction variants;
   * computed CSS backgrounds, including `::before`/`::after`, plus every stylesheet rule (so mobile-only `@media` backgrounds are found);
   * links that point straight at image files (lightbox full-size images);
   * `og:image`, JSON-LD `logo`/`image`, icons, and inline `<svg>` logos (serialised with their computed colours);
   * any image the browser downloaded over the network.
3. **Validate.** Each image is fully decoded by Sharp. Truncated or corrupt files and unsupported formats are dropped.
4. **De-duplicate.** Exact copies (same bytes) and visual copies (the same picture at another size or compression, detected with a perceptual difference hash) are merged, keeping the highest-resolution version. Desktop/mobile/size variants of one scene (`banner.webp`, `banner-mob.webp`, `hero-1400.webp`) count as one *family*, so a size folder never contains two crops of the same picture.
5. **Classify.**
   * **Logo.** Scored on the word "logo"/"brand" in file name, alt text or class; position in the header; linking to the home page; structured data; SVG (vector beats raster); resolution. Social, WhatsApp, QR, RERA, bank and award logos are penalised. White-on-transparent logos are avoided, or placed on a dark canvas if nothing else exists.
   * **Photos.** Must be opaque, colourful and not mostly blank paper. Floor plans, master plans, location maps, price lists, icons, patterns, overlays and decorative footer backgrounds are excluded by image statistics plus file-name, class and section keywords.
   * **Sections.** Every image is tagged with where it appears on the page. *Gallery section*: an ancestor named gallery/portfolio, a lightbox gallery group, or a section headed "Gallery". *Hero section*: a block near the top named hero/banner/main-slider/…, or the large visual block in the middle of the first screen. A hero image excludes its whole family (desktop, mobile and resized variants).
6. **Plan.** For each size, gallery-section photos are used first; photos from other sections only fill the remaining slots. Within each group, photos are ranked by resolution, detail and how little cropping they need. From each family, the version needing the least cropping is used. A source qualifies only if it reaches the target size with at most `--max-upscale` enlargement.
7. **Render.** Sharp scales uniformly (aspect ratio always preserved) and crops around the most salient region (`attention`), using the Lanczos3 filter with light sharpening when an image had to be enlarged. Logos are trimmed and fitted into the reference canvases. SVG logos are rasterised at the exact resolution needed, so they stay perfectly sharp.

---

## Programmatic use

```js
const { packageWebsite, zipPackage, formatSummary, createLogger } = require('website-image-packager');

const result = await packageWebsite({
  url: 'https://example.com',
  outDir: './project-name',
  maxUpscale: 1.5,      // same options as the CLI, in camelCase
  logger: createLogger({ level: 'info' }),
});

console.log(formatSummary(result));
if (!result.complete) console.log(result.missing);   // array of human-readable strings
await zipPackage(result.outDir);                     // → { path, bytes }
```

`result` contains `logos`, `banners` (per folder: the files and the source URL, size and enlargement of each), `gallery`, `missing`, `warnings` and `stats`.

---

## Safety

* The tool only ever writes `logo.png`, `logo-1.png`, `gallery/`, `Discovery/`, `Remarketing/` and `<folder>.zip` inside the output folder.
* If those already contain files the tool did not create (for example, a website's own `discovery/` folder; names are case-insensitive on Windows), it stops without changing anything.
* A previously generated package is only replaced with `--force`, and then only the generated files are removed.

---

## Tips and limitations

* **Logo quality.** Websites often serve small logos (200–400 px). Enlarging those to 1200 px is reported as a warning. For the sharpest result, pass an SVG or large PNG with `--logo`. When the site has several logos (developer and project), the summary lists the alternatives so you can choose with `--logo <url>`.
* **Text inside images.** Hero banners sometimes contain baked-in text. The `attention` crop usually keeps the text block, but it can't read text. Review crops of designed banners before publishing.
* **Short folders.** These mean the site doesn't have enough distinct, large photos. Raise `--max-upscale` (e.g. `2`) to accept softer images, or add photos yourself.
* **Bot protection.** Sites behind aggressive bot protection or logins may return nothing. Try `--headed` or `--browser chrome`.
* **Rights.** Only use images and logos you're allowed to use in advertising.

---

## Development

```bash
npm install
npm test          # unit tests + an end-to-end test against a local JavaScript-rendered fixture site
```

Project layout:

```text
bin/website-images.js   CLI (commander), summary output, ZIP question
src/index.js            packageWebsite(): orchestration
src/extract.js          Playwright: desktop + mobile passes, network capture, merging
src/page-scripts.js     code that runs inside the page (collection, auto-scroll)
src/download.js         downloads + validation
src/analyze.js          Sharp decode, statistics, perceptual hash
src/select.js           de-duplication, logo scoring, photo ranking, banner planning
src/render.js           smart crops, logo canvases, WebP gallery
src/output.js           safe output-folder handling
src/zip.js              ZIP creation (yazl)
src/config.js           folder layout, sizes, file names, defaults
```

MIT licensed. Dependencies: playwright (Apache-2.0), sharp (Apache-2.0), commander (MIT), yazl (MIT).
