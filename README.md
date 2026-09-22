# BMW M5 CS — Engineered for the Apex

An unofficial, cinematic **scroll-driven 3D car showcase** for the BMW M5 CS (F90), built as a
single-page Next.js app. A real BMW M5 CS model is loaded into a fully procedural 3D showroom
(cyclorama wall, softbox light strips, volumetric light shaft, dust motes, mirrored floor) and the
camera flies around it 1:1 with your scroll position — hero → front fascia → rear diffuser →
closing card. Along the way you can repaint the car, swap wheels and brake calipers, toggle a
carbon hood, switch studio themes, and start/rev a synthesised twin-turbo V8.

> Not affiliated with, endorsed by, or sponsored by BMW AG. "BMW", "M5", "M5 CS" and the BMW roundel
> are trademarks of their respective owners. This is a design/engineering demo built for fun.

---

## Table of contents

- [What is this project?](#what-is-this-project)
- [Feature tour](#feature-tour)
- [How it works](#how-it-works)
- [Tech stack](#tech-stack)
- [Requirements](#requirements)
- [Run it on localhost](#run-it-on-localhost)
  - [1. Production build (recommended)](#step-4--production-build-recommended)
  - [Environment variables](#environment-variables)
- [Project structure](#project-structure)
- [Deploy to Vercel](#deploy-to-vercel)
- [Troubleshooting](#troubleshooting)
- [Credits & licenses](#credits--licenses)

---

## What is this project?

A one-page, immersive product experience for the **BMW M5 CS** — the most powerful 5 Series BMW has
built (4.4 L twin-turbo V8, 627 hp, 70 kg lighter than the M5 Competition, and the basis for this
whole narrative). Instead of a static marketing page, the whole page is a **3D studio inspection**:

| | |
| --- | --- |
| **Route** | `/` — the entire experience is one page (`/api` returns a `{"message":"Hello, world!"}` health JSON) |
| **Content** | Hero copy, front/rear "stage captions", closing card, reservation modal |
| **3D** | `public/models/bmw-m5-cs/scene.min.glb` (meshopt-compressed, 3.2 MB) rendered with three.js |
| **Interactivity** | Scroll-scrubbed camera, paint/wheel/caliper configurator, studio themes, orbit mode, engine audio |
| **Backend** | None required. No database, no auth, no external API. Prisma/SQLite files exist as leftover scaffold and are **not** imported by the app |

Because there is no backend and no runtime data fetching, the app is fully static-friendly and
deploys anywhere that can run Next.js (it is deployed on Vercel).

## Feature tour

- **Scroll-scrubbed camera choreography** — one GSAP timeline (`scrub: 1.2`) driven by an invisible
  440vh scroll track and smooth-scrolled by Lenis, so every frame reverses perfectly when you scroll
  back up. Camera keyframes (hero → front → rear → outro) are plain editable data in
  `src/components/scroll-experience.tsx` (`KEYS`).
- **Fully procedural showroom** — cyclorama wall with panel seams, warm horizon glow, overhead
  softbox strips, light pillars with floor reflections, runway lines, a volumetric light shaft with
  drifting dust, and a mirrored-car floor reflection. Every texture is drawn on a `<canvas>` at
  runtime: **zero image assets, zero CDN calls**.
- **Live vehicle configurator dock**:
  - Paints: Frozen Deep Green, Brands Hatch Grey, Frozen Bluestone, Black Sapphire
  - Wheels: Gold Bronze (CS signature), Jet Black High-Gloss, Frozen Orbit Grey, Brilliant Silver
  - Calipers: M Carbon Ceramic Gold, M Compound Sport Red, M Performance Blue, Acid Neon Yellow
  - Studio themes (Apex / M / Night), carbon-fibre hood, high-beam floodlights, orbit mode
- **Synthesised V8 soundtrack** — no audio download: `src/lib/v8-audio.ts` / `src/lib/engine-audio.ts`
  build an idle + rev engine note live with the Web Audio API (oscillators, noise, filters). Browsers
  only allow audio after a user gesture, so press **Start Engine** / **Rev** in the dock.
- **Hotspots** — engine, cockpit, wheels and aero call-outs with their own camera moves
  (`src/types/configurator.ts → HOTSPOTS`), available in orbit mode.
- **"Book a Drive" reservation modal** — a client-side demo form with a confirmation state.
  It does not POST anywhere; wire it to your own endpoint if you need it to.
- **Responsive** — the camera widens its FOV and pushes back on portrait screens
  (`FOV_MOBILE`, `mobileF`, `mobileHeadOn`), and the UI collapses into a compact dock.

## How it works

```
scrolling (Lenis) ──► ScrollTrigger scrub ──► GSAP timeline ──► camera position/lookAt per frame
                                            └► opacity of hero copy / captions / closing card
three.js render loop ──► car rig + procedural showroom (canvas textures) ──► <canvas class="fixed inset-0">
```

- The page is a fixed full-viewport stage (canvas + UI overlay) plus an invisible **440vh scroll
  track** — functionally the same as a `ScrollTrigger` pin, but jitter-free with Lenis on every
  browser.
- The GLB is fetched with a stream reader, so the branded loading overlay shows the **real** byte
  percentage, then fades once the model has parsed (min 0.8 s hold so it never flashes).
- The car mesh is normalised to a known world length (`TARGET_LENGTH = 4.6`) so camera keyframes stay
  valid, and wheel hubs are detected from the mesh bounds for the wheel/caliper material swaps.
- Mobile detection (`use-mobile.ts`) disables the expensive extras (floor reflection pass).

## Tech stack

| Layer | Choice |
| --- | --- |
| Framework | Next.js 16 (App Router, Turbopack) + React 19 + TypeScript |
| 3D | three.js r186, `GLTFLoader`, `RoomEnvironment`, `MeshoptDecoder`, PMREM environment lighting |
| Animation | GSAP + ScrollTrigger (scrubbed timeline) and Lenis (smooth scroll) |
| Styling | Tailwind CSS v4, shadcn/ui components (Radix primitives), lucide-react icons |
| Fonts | Inter, self-hosted through `next/font/local` (no `fonts.googleapis.com` dependency at build time) |
| Audio | Web Audio API engine synthesis (no audio files fetched) |
| Deployment | Vercel (any Next.js host works) |

## Requirements

- **Node.js 20.9 or newer** (Node 22 LTS recommended — Next.js 16 requires ≥ 20.9)
- npm 10+ (a `package-lock.json` is committed; `pnpm`/`yarn` also work)
- A WebGL-capable browser: Chrome/Edge/Firefox 111+ or Safari 16.4+. The 3D scene needs WebGL 2;
  nothing renders on browsers with WebGL disabled.
- Roughly 1 GB of free disk space for `node_modules` and the build cache.

## Run it on localhost

### Step 1 — Clone the repository

```bash
git clone https://github.com/5krm/m5cs.git
cd m5cs
```

### Step 2 — Install dependencies

```bash
npm install
```

### Step 3 — Start the dev server

```bash
npm run dev
```

The script is `next dev -p 3000 -H 0.0.0.0`. Open **<http://localhost:3000>** and scroll.

First load in dev mode compiles on demand and pulls the 3.2 MB GLB — expect a short branded loading
overlay the first time; after that it is instant.

### Step 4 — Production build (recommended)

To check exactly what a deploy will serve:

```bash
npm run build     # next build + scripts/postbuild.mjs (copies .next/static & public/ into the bundle)
npm start         # NODE_ENV=production node .next/standalone/server.js
```

Then open <http://localhost:3000> again. To use another port:

```bash
PORT=4000 npm start
```

> `next.config.ts` sets `output: "standalone"` **only when not building on Vercel**
> (`output: process.env.VERCEL ? undefined : "standalone"`) — Vercel's Next.js adapter does its own
> output tracing and expects the default `.next` layout, while `npm start` needs the standalone
> bundle. Both paths are covered, so you don't have to change anything.

### Environment variables

**None are required.** The app has no backend, no database and no API keys.

A committed `.env` contains the leftover scaffold value `DATABASE_URL=file:.../db/custom.db` for the
Prisma schema in `prisma/schema.prisma`. Nothing in `src/` imports Prisma at runtime, so you can
ignore it — or copy `.env.example` and point it at a local SQLite file if you want to use the
scaffold. See `.env.example`.

### npm scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Dev server with hot reload on <http://localhost:3000> (binds `0.0.0.0`) |
| `npm run build` | Production build + assembles `.next/standalone` for `npm start` |
| `npm start` | Serves the standalone production build |
| `npm run lint` | ESLint (flat config, `eslint-config-next`) |
| `npm run db:push` / `db:generate` / `db:migrate` / `db:reset` | Optional Prisma helpers for the unused SQLite scaffold |

## Project structure

```
m5cs/
├─ src/
│  ├─ app/
│  │  ├─ layout.tsx              # metadata, self-hosted Inter, global CSS
│  │  ├─ page.tsx                # renders <ScrollExperience /> (client-only, with loading state)
│  │  ├─ globals.css             # Tailwind v4 tokens, CTA/glass styles, reset
│  │  ├─ api/route.ts            # GET /api → {"message":"Hello, world!"}
│  │  └─ fonts/                  # Inter woff2 (variable, Latin + italic) + OFL license
│  ├─ components/
│  │  ├─ scroll-experience.tsx   # the whole experience: three.js scene, camera keys,
│  │  │                          # procedural showroom, GLB loading, GSAP/Lenis timeline, UI overlay
│  │  ├─ configurator-dock.tsx   # paint / studio / audio control dock
│  │  ├─ hotspots-overlay.tsx    # hotspot call-outs (engine, cockpit, wheels, aero)
│  │  ├─ m5-experience.tsx       # thin re-export of scroll-experience
│  │  └─ ui/                     # shadcn/ui primitives
│  ├─ hooks/                     # use-mobile, use-toast
│  ├─ lib/
│  │  ├─ v8-audio.ts             # Web Audio V8 synth (start/stop/rev)
│  │  ├─ engine-audio.ts         # alternative synth implementation
│  │  ├─ db.ts                   # unused Prisma client wrapper (safe no-op fallback)
│  │  └─ utils.ts                # cn() helper
│  └─ types/configurator.ts      # paints, wheels, calipers, themes, hotspots (edit content here)
├─ public/
│  ├─ models/bmw-m5-cs/scene.min.glb   # meshopt-compressed M5 CS (CC-BY-4.0, see license.txt)
│  ├─ audio/                           # optional pre-rendered engine samples (unused by default)
│  ├─ textures/studio_360.jpg          # optional HDRI-ish backdrop
│  ├─ bmw-logo.svg, bmw-roundel.png, logo.svg, robots.txt
├─ scripts/postbuild.mjs         # copies .next/static + public/ into .next/standalone (skipped on Vercel)
├─ prisma/schema.prisma          # unused scaffold (User/Post models, SQLite)
├─ next.config.ts                # conditional standalone output, cache headers, allowed dev origins
├─ .github/workflows/deploy-vercel.yml  # optional CI deploy (needs a VERCEL_TOKEN secret)
├─ tailwind.config.ts, postcss.config.mjs, components.json, eslint.config.mjs, tsconfig.json
├─ worklog.md                    # build log of the AI-assisted build (dev notes, not app code)
└─ .zscripts/                    # original scaffold helper scripts (not needed to run the app)
```

## Deploy to Vercel

No configuration is required: Vercel detects the Next.js framework preset, runs `npm run build`,
and injects its own `PORT`/`NODE_ENV`. Don't add a custom build/output override.

### Option A — Import the Git repository (recommended, ~1 minute)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/5krm/m5cs)

1. Go to **<https://vercel.com/new>** and sign in (GitHub login is easiest).
2. Under *Import Git Repository*, pick **`5krm/m5cs`** (authorise the Vercel GitHub App for the repo
   if asked — the repository is public, so any account can import it).
3. Leave everything at the defaults:
   - Framework Preset: **Next.js**
   - Root Directory: **`./`**
   - Build Command: **`npm run build`** · Output Directory: **default** · Install Command: **default**
   - Environment Variables: **none**
4. Press **Deploy**. When it finishes you get `https://<project-name>.vercel.app`.
5. Every later push to the production branch (usually `main`) redeploys automatically; every pull
   request gets its own preview URL.

### Option B — Vercel CLI from your machine

Run this in the repository root on a machine that can reach `vercel.com`:

```bash
npm i -g vercel            # or use npx vercel
vercel login               # interactive, once
vercel                     # first run: create/link the project (accept the defaults)
vercel --prod              # deploy to production
```

Non-interactive (CI, or an already-created token):

```bash
export VERCEL_TOKEN=vcp_xxxxxxxxxxxxxxxxxxxxxxxx
vercel deploy --prod --yes --token "$VERCEL_TOKEN"
```

The first `--yes` run creates a project named after the folder (`m5cs`) with the Next.js preset.

### Option C — GitHub Actions (deploy on every push to `main`)

A workflow is included at `.github/workflows/deploy-vercel.yml`. It needs one repository secret:

**GitHub → repository → Settings → Secrets and variables → Actions → New repository secret**
Name `VERCEL_TOKEN`, value your Vercel token → then push to `main`, or run the workflow manually
from the **Actions** tab. Without the secret the workflow exits cleanly without deploying.

> Treat that token like a password. A token pasted into chat, an issue, or a log should be revoked in
> **Vercel → Account Settings → Tokens** and replaced with a fresh one.

### Do you need a `vercel.json`?

No. This project ships none on purpose — Next.js defaults are already correct. Only add one if you
later need redirects, custom headers that depend on deploy-time values, cron jobs, or a region pin.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `Failed to fetch Inter from Google Fonts` during build | This project does **not** use Google Fonts any more — Inter is vendored in `src/app/fonts/`. If you see this, you are on an older commit or re-added `next/font/google`; switch back to `next/font/local` (see `src/app/layout.tsx`). |
| Page loads but the car never appears | Check the browser console and that `http://localhost:3000/models/bmw-m5-cs/scene.min.glb` returns 3 188 780 bytes. WebGL must be enabled (`chrome://gpu`). Hardware acceleration off ⇒ the scene may be very slow. |
| Scroll does nothing / page feels stuck | Try a private window or disable scroll-hijacking extensions — Lenis + ScrollTrigger need an unmodified scroll container. |
| No engine sound | Browsers block audio until a user gesture; click **Start Engine** / **Rev** in the dock. |
| `npm start` fails after `npm run dev` | Dev and production share `.next/`. Run `npm run build` again before `npm start`. |
| Vercel log: `ENOENT ... .next/next-server.js.nft.json` | `output: "standalone"` was active during a Vercel build. Keep `next.config.ts` as shipped (it disables standalone when `VERCEL=1`), or remove the option if you never self-host. |
| Port 3000 already in use | `PORT=4000 npm start`, or `npm run dev -- -p 4000`. |
| Slow first paint on localhost | Turbopack compiles routes on demand in dev. Use the production build to judge real performance. |

## Credits & licenses

- **3D model** — "BMW M5 CS (F90)" by **fvrenbld** (Sketchfab), licensed **CC-BY-4.0**. The original
  `gltf`/`bin` was converted to a single meshopt-compressed GLB; the attribution text ships with the
  asset at `public/models/bmw-m5-cs/license.txt`. Commercial use is allowed **with credit** — keep
  that credit if you reuse or redistribute the model.
- **Inter font** — © The Inter Project Authors (Rasmus Andersson), **SIL Open Font License 1.1**
  (`src/app/fonts/LICENSE.txt`). Files vendored from `@fontsource-variable/inter` v5.3.0.
- **Application code** — this repository. shadcn/ui components keep their upstream (MIT) licensing.
- BMW brand assets (roundel, wordmarks) are trademarks of BMW AG and are used here for a
  non-commercial design demo only.
