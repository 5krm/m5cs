# BMW M5 CS — Engineered for the Apex

An unofficial, cinematic **3D BMW M5 CS configurator** built with Next.js. The car is presented through a short, scroll-driven studio story; visitors can then change the paint, wheel finish, brake calipers, lighting, and environment, and share a link to their exact build.

> This is an independent design/engineering demo. It is not affiliated with, endorsed by, or sponsored by BMW AG. BMW names and marks are trademarks of their respective owners. The vehicle model is credited separately below.

## What the experience does

- **Guided 3D story:** a fixed Three.js stage moves through hero, front, rear, X-ray/specification, and closing views as the visitor scrolls. The camera choreography reverses with the scroll.
- **Build controls:** four paint finishes, four wheel finishes, four caliper colors, three studio-lighting presets, and headlight controls.
- **Environments:** a procedural studio plus seven optional, procedural locations—Nürburgring, Munich Garage, Alpine Pass, Tokyo, Dubai, Monaco, and Cargo Docks. Alternate locations are imported only when selected; no panorama downloads are used for the environments.
- **Cockpit and camera:** enter a driver's-eye view, drag to look around, or toggle a free-orbit camera.
- **Saved and shareable builds:** the current setup is stored in local browser storage. **Share build** copies a URL containing the selected finishes, location, and lighting settings. Query-string builds take precedence over a locally saved build.
- **Resilient startup:** the model is streamed with download progress, then reports the preparation stage. If WebGL or the model is unavailable, the page shows a readable recovery message rather than failing silently.
- **Motion preferences:** reduced-motion settings remove Lenis smoothing, make the camera follow scroll immediately, and disable the showroom dust animation.

## Honest product boundaries

This version is a front-end concept, not a BMW sales tool. It does not collect personal information, submit a test-drive request, or contact a retailer. The **Drive info** action explains this and provides the current build summary; it does not display a fake booking confirmation. The `/api` route is only a basic health/demo response, not a product backend.

Build choices are kept in local storage and in a share link only when the visitor chooses to share. The app does not send those choices to a server. Engine-audio experiments and sample files from earlier iterations remain in the repository but are not part of the current experience.

## Technology

| Layer | Implementation |
| --- | --- |
| Framework | Next.js App Router, React, TypeScript |
| 3D | Three.js, GLTFLoader, MeshoptDecoder, PMREM environment lighting |
| Motion | GSAP + ScrollTrigger and Lenis; reduced-motion support |
| Styling | Tailwind CSS, with self-hosted Inter fonts |
| Vehicle asset | Meshopt-compressed GLB, approximately 3.2 MB |
| Storage | Browser local storage for the last build; URL query parameters for sharing |
| Server | No application database, authentication, or lead-capture service is required |

## Run locally

### Requirements

- Node.js **20.9+** (Node 22 LTS recommended)
- npm 10+
- A modern browser with WebGL support for the full 3D experience

### Install and run

```bash
npm ci
npm run dev
```

Open <http://localhost:3000>. The first run downloads the model; the browser cache is used on later visits where available.

### Verify changes

```bash
npm run lint       # ESLint
npm run typecheck  # TypeScript, including the production experience
npm test           # build-configuration validation and share-link tests
npm run audit:prod # audit production dependencies
npm run build      # optimized production build + standalone assembly
npm run check      # all of the above in sequence
```

For a self-hosted production build:

```bash
npm run build
npm start
```

No environment variables are needed for the experience. The legacy Prisma/SQLite files and database scripts are not used by the app.

## Project structure

```text
src/
├─ app/
│  ├─ page.tsx                     # hydration gate and error boundary
│  ├─ layout.tsx                   # metadata and self-hosted fonts
│  ├─ globals.css                  # global tokens and experience styles
│  └─ api/route.ts                 # placeholder health/demo response
├─ components/
│  ├─ scroll-experience.tsx        # Three.js stage, camera story, controls, overlays
│  ├─ configurator-dock.tsx        # paint/wheel/brake/studio/location controls
│  ├─ cockpit-overlay.tsx          # driver's-eye HUD
│  └─ experience-error-boundary.tsx
├─ lib/
│  ├─ build-config.ts              # validated defaults, local restore, share-link encoding
│  ├─ locations/                   # procedural environments, imported on demand
│  ├─ procedural/                  # deterministic terrain/material helpers
│  └─ webgl-support.ts             # capability probe and graceful fallback
└─ types/configurator.ts            # options, scene definitions, specifications

public/models/bmw-m5-cs/scene.min.glb # compressed M5 CS model
```

## Credits and licensing

- **3D model:** “BMW M5 CS (F90)” by **fvrenbld** (Sketchfab), licensed **CC-BY-4.0**. Attribution is included at `public/models/bmw-m5-cs/license.txt`; keep it if reusing or redistributing the model.
- **Inter font:** Inter Project Authors, **SIL Open Font License 1.1**; license at `src/app/fonts/LICENSE.txt`.
- **BMW branding:** BMW names, logos, and marks are trademarks of BMW AG. Their presence here does not imply authorization or endorsement.
