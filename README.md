# Website Image Packager – web

A website for [website-image-packager](https://www.npmjs.com/package/website-image-packager).
Paste a site's address and the server opens it in headless Chromium, picks the logo and photos,
and builds the Google Ads Discovery / Remarketing banner package. The browser shows the package
filling in as it is built, then offers the ZIP.

- **Front end:** React 19, built with Vite (`src/`)
- **Server:** Node + Express 5 (`server/`). It calls the packager's `packageWebsite()` and
  `zipPackage()` directly, so a package has the same layout and files as one made with the CLI.

## Run it

Requires Node 20.19+ or 22.12+. `npm install` also downloads Playwright's Chromium (through the
packager's postinstall step).

```sh
npm install
npm run dev      # development with hot reload: http://localhost:3000
```

Production:

```sh
npm run build    # builds the React app into dist/
npm start        # serves dist/ and the API on http://localhost:3000
```

On a Linux server, also install Chromium's system libraries once: `npx playwright install --with-deps chromium`.

## Configuration

All settings are environment variables.

| Variable | Default | What it does |
| --- | --- | --- |
| `PORT` | `3000` | Port to listen on. |
| `HOST` | `127.0.0.1` | Interface to bind. Use `0.0.0.0` to accept outside connections (for example in a container). |
| `JOBS_DIR` | `<os temp>/website-image-packager-web` | Where packages are written. Job folders (UUID names) left from a previous run are removed at startup. |
| `MAX_CONCURRENT_JOBS` | `2` | Packages built at the same time. Each one runs a Chromium instance. |
| `MAX_QUEUED_JOBS` | `20` | Waiting packages before new requests get HTTP 503. |
| `MAX_JOBS_PER_CLIENT` | `2` | Unfinished packages one IP address may have. |
| `JOB_TTL_MINUTES` | `360` | How long a finished package (files and ZIP) is kept. |
| `TRUST_PROXY` | off | Set when running behind a reverse proxy (`true`, a hop count, or addresses) so client IPs are read from `X-Forwarded-For`. |
| `ALLOW_PRIVATE_URLS` | off | `1` lets the server open localhost and private-network addresses. Leave off on a public server. |
| `CORS_ORIGINS` | empty | Comma-separated browser origins allowed to call the API, such as `https://banner-folder.vercel.app`. |

## Deploy the frontend on Vercel and the API on Render

The web app needs a persistent Node process for its Express API, job queue, Chromium browser and temporary package files. Vercel can host the frontend, but deploying only the Vite site does not provide `/api/config` or `/api/jobs` (those requests return 404).

1. Create a Render Blueprint from this repository and use the included `render.yaml`. The Docker image installs Chromium and starts the Express server. Set `CORS_ORIGINS` to the exact Vercel site origin, for example `https://banner-folder.vercel.app` (no trailing slash).
2. Copy the Render service URL, such as `https://your-api.onrender.com`.
3. In the Vercel project, add the build environment variable `VITE_API_BASE_URL` with that Render URL (no trailing slash), then redeploy the frontend.
4. Verify `https://your-api.onrender.com/healthz` returns JSON with `"ok": true`, and that `https://your-api.onrender.com/api/config` returns the packager configuration.

The included Render service uses the free plan, which may sleep when idle and has limited memory. If Chromium jobs run out of memory or time out, move the service to a plan with more resources. Jobs and generated files are temporary and are lost when the service restarts.

Jobs are kept in memory: restarting the server forgets them, and their folders are deleted on the next start.

## How it works

1. `POST /api/jobs` validates the settings and queues a job. Its ID becomes the page address (`/#/jobs/<id>`),
   so a package link can be shared or reloaded.
2. The job runs `packageWebsite()` into its own folder. The packager's log lines are streamed to the
   browser over server-sent events (`GET /api/jobs/:id/events`). The server turns them into steps and
   tells the page when each banner size has been written, so frames fill in while the job runs.
3. When it finishes, `zipPackage()` creates `<name>.zip` and the page shows the result: every file, the
   gaps with the packager's explanation, and one-click rebuilds (allow 2× enlargement, use hero images,
   use another logo found on the site, smaller gallery minimum).

| Endpoint | Returns |
| --- | --- |
| `GET /api/config` | Package layout, default settings and limits |
| `POST /api/jobs` | New job (202) or `{ error, field }` (400/429/503) |
| `GET /api/jobs/:id` | Job status, settings, log and result |
| `GET /api/jobs/:id/events` | Server-sent events: `snapshot`, `update`, `log`, `gone` |
| `GET /api/jobs/:id/files/<path>` | A file from the package, such as `Discovery/1200x628/image.png` |
| `GET /api/jobs/:id/thumbs/<path>` | WebP preview of that file (longest side 800 px), cached outside the package |
| `GET /api/jobs/:id/download` | The ZIP |
| `GET /api/jobs/:id/report` | The JSON report (the CLI's `--report`) |

Request fields for `POST /api/jobs`: `url`, `name`, `imagesPerSize` (1–10), `maxUpscale` (1–4), `crop`
(`attention`, `entropy`, `center`), `includeHero`, `mobilePass`, `timeoutSeconds` (5–120), `gallery`,
`maxGallery` (0–100), `minGallerySize` (100–10000), `logoBackground` (`white`, `transparent`, `#rrggbb`),
and `logoMode`: `auto`, `url` (with `logoUrl`) or `upload` (with `logoData`, a base64 data URL up to 8 MB).

## Before putting it on the internet

The server opens any address it is given in a real browser, so:

- Addresses (and logo URLs) that resolve to loopback, private, link-local or reserved IPs are refused
  unless `ALLOW_PRIVATE_URLS=1`. This checks the address typed in. It does not cover redirects or
  the images and scripts a page loads afterwards, which the browser fetches directly. For a public
  deployment, also run the server where it cannot reach internal services: a container or VM with
  outbound traffic limited to the internet.
- The `--logo` option never receives a local file path from the web; uploads are passed as data URLs.
- Anyone with a job's link can see that package until it expires. IDs are random UUIDs.
- There is no login. Put it behind your own authentication or a VPN if it should not be public.
- The built site sends a strict Content-Security-Policy. The dev server doesn't, because Vite injects inline scripts.

## Project layout

```
server/
  index.js      Express app, Vite middleware in dev, static dist/ in production
  api.js        Routes, file and thumbnail serving
  jobs.js       Queue, packager runs, log streaming, cleanup
  validate.js   Request checks and the private-network guard
  config.js     Environment variables
src/
  App.jsx       Page state, routing by URL hash, rebuilds
  components/   BuildForm, StatusPanel, Sheet (the to-scale package view), Viewer
  useJob.js     Follows a job over server-sent events
test/           node --test suite for request validation and file paths
```

`npm test` runs the server tests.
