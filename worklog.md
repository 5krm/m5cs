# Project Worklog

---
Task ID: 1
Agent: Z.ai Code (main agent)
Task: Build a full-viewport hero section for the "NeuroLink" online memorial website (desktop-first, fully responsive) per a detailed pixel-precise spec.

Work Log:
- Inspected project scaffold: Next.js 16 (App Router, Turbopack), Tailwind CSS 4, shadcn/ui present; dev server already running on port 3000.
- Rewrote `src/app/layout.tsx`: Inter via `next/font/google` (variable wght 100–900 covering requested 400/500/600/700), exposed as `--font-inter`; added NeuroLink metadata (title, description, OpenGraph). Initial Google Fonts `<link>` approach was replaced by next/font after confirming fonts.googleapis.com reachability (also removes the `no-page-custom-font` lint warning).
- Rewrote `src/app/globals.css`: kept Tailwind v4/shadcn theme tokens; added spec body reset (margin/padding 0, bg #0d1017, text #f2efe7, Inter font-family), default link colors (#e8ddc4 / hover #f5edd8), `.hero-shell` (min-height 100vh → 100svh fallback), overlay classes (`.overlay-fade`, `.overlay-vignette`, `.bottom-glow` with exact oklch gradients), `.signin-btn` glassy pill (blur 12px, hover bg/border per spec), `.cta-btn` white pill (black text, hover translateY(-1px) only).
- Rewrote `src/app/page.tsx` as a client component implementing the full spec:
  - Container: flex column, relative, overflow-hidden, exact fallback gradient behind the video.
  - Background video: exact CDN URL, `autoplay muted loop playsinline preload="none"`, object-fit cover; useEffect sets muted → src → play() and attaches a `pause` listener that re-plays (spec's "never stops" guarantee).
  - Overlays: bottom fade (transparent 0–42% → oklch dark), radial vignette, bottom glow (1600×600 at bottom −320px) — top of video stays completely clear.
  - 6 floating star dots with exact positions/sizes/opacities/glow shadows.
  - Navbar: exact 129×36 NeuroLink SVG logo (currentColor #f5f2ea), links (How It Works · Tributes · Pricing · Support, 13px/400/0.02em, white), glassy Sign In pill; flex-wrap + clamp paddings for responsiveness.
  - Hero content bottom-anchored via `mt-auto`: ✦ gold star ornament with 48×1px gradient lines, H1 "Where Memories Live Forever" (nowrap, Inter 600, #f7f4ec + white span, fluid `clamp(22px,5.5vw,44px)` capped at spec's 44px desktop size), two-line secondary text (`<br>` after "cherished", hidden below `sm` so mobile wraps naturally), white "Create Memorial →" pill CTA with exact inline arrow SVG.
- Lint: 0 errors, 0 warnings.
- Agent Browser verification (1440×900, 768×1024, 375×667):
  - Video confirmed playing (paused=false, muted=true, loop=true, currentTime advancing, readyState=4); forced `pause()` auto-resumed in <700ms.
  - Inter 600 @ 44px on desktop (fluid 42.24px tablet / 22px mobile); no horizontal overflow at any width; H1 never overflows; CTA visible and hover = translateY(-1px), black-on-white.
  - Accessibility tree correct (nav "Primary", 4 links, Sign In, H1 level 1, "Create Memorial" link).
  - Zero console/page errors; dev.log clean across all compiles.

Stage Summary:
- Shipped the complete NeuroLink hero at `src/app/page.tsx` (+ `layout.tsx`, `globals.css`); only the `/` route is used.
- Video autoplays muted+loop with a JS pause-resume guarantee; fallback gradient shows if the CDN is unreachable.
- Responsive: clamp()-based spacing/typography, wrapped navbar, svh unit for mobile browser chrome; verified at desktop/tablet/mobile with no overflow.
- Two documented micro-adaptations of the spec for responsiveness: H1 uses clamp capped at 44px (exact 44px on desktop), and the secondary-text `<br>` is desktop-only (natural wrap on mobile).

---
Task ID: 2
Agent: Z.ai Code (main agent)
Task: Replace the hero background video with a real-time 3D scene — a gray BMW M5 CS drifting donuts with tire smoke — then restyle the car to match a user-uploaded reference photo.

Work Log:
- Installed three@0.186, @react-three/fiber@9.7, @react-three/drei@10.7 (+ @types/three).
- Created `src/components/bmw-drift-scene.tsx` (client-only, ~600 lines):
  - Car built from an extruded side profile (wheel arches cut via absarc), dark glasshouse, kidney grilles with mesh slats, LED headlights + additive glow billboards, taillight strip, mirrors, splitter, side skirts, diffuser, shark fin, quad exhausts, canvas-drawn BMW roundels.
  - Drift simulation: circular path (R=5.2, ω=0.85) with 0.55 rad slip angle, counter-steer + wobble, rear wheels spinning at 30 rad/s vs 14 front, body roll/pitch/bounce.
  - Tire smoke: 320-particle pooled THREE.Points system with custom ShaderMaterial (per-particle size/alpha attributes, canvas soft-circle sprite), 165 spawns/s from rear-wheel world positions, drag + buoyancy, ring-shaped haze around the donut.
  - Baked canvas skid-ring texture on the ground + ContactShadows; module-scope mutable stores (carChannel/smokeStore) satisfy the new React Compiler lint rules (react-hooks/immutability).
- Updated `src/app/page.tsx`: removed the background video + autoplay effect; scene loaded via next/dynamic ssr:false with gradient fallback. All overlays/dots/navbar/hero copy unchanged.
- Camera iterations (verified via agent-browser screenshots): fixed orbit → chase cam → final yaw-following rear-3/4 chase (distance 8.6, height 2.6, ±0.7 rad slow swing, pointer parallax, aim y=0.5) so the framing always flatters the car; scene background #0d1017 to remove the horizon seam.
- Restyled to match the uploaded photo: satin gloss gray #9aa0a5 paint (clearcoat), gloss-black wheels with brake discs + red calipers, larger mesh kidneys, white LED headlights, dark red taillights, gloss-black mirrors/skirts, shark fin, bigger front lip.
- Verified: lint 0 problems; two desktop frames 10 s apart show continuous drift with stable framing; mobile 390×844 no overflow, CTA visible; zero console/page errors; dev.log clean throughout.

Stage Summary:
- Hero background is now a live WebGL drift scene (`bmw-drift-scene.tsx`) instead of the CDN video; the video URL/effect was fully removed.
- Car styling now mirrors the user's reference photo (gray M5 CS, black wheels, white LEDs).
- All prior hero elements (navbar, ornament, headline, copy, CTA, overlays, star dots) preserved and re-verified.

---
Task ID: 2
Agent: Z.ai Code (main agent)
Task: Replace the hero background with the user's uploaded real 3D model — a gray BMW M5 CS (F90) drifting donuts with tire smoke — keeping the existing overlays, star dots, navbar and hero content intact.

Work Log:
- Extracted `upload/bmw_m5_cs_f90.zip` → `scene.gltf` (164 KB) + `scene.bin` (13 MB), 0 external textures, CC-BY-4.0 (author: fvrenbld, Sketchfab). Verified materials already use standard `pbrMetallicRoughness` (blue body paint) — no offline conversion needed.
- Copied model to `public/models/bmw-m5-cs/` (scene.gltf, scene.bin, license.txt).
- Installed `three@0.186`, `@react-three/fiber@9.7`, `@react-three/drei@10.7`, `@types/three` (dev).
- Rebuilt `src/components/bmw-drift-scene.tsx` around the real glTF (previously a procedural extruded-shape car):
  - `buildCar()`: clones the cached glTF scene, normalizes it (centers footprint, grounds at y=0, longest horizontal span → 4.6 world units), repaints body materials (Bodyshell/Bonnet/Boot/DoorColor) with metallic gray `MeshPhysicalMaterial` (clearcoat) and windows with dark glass, hides giant flat showroom plates.
  - Smoke anchors (`Object3D`) at the rear tire contact patches publish world positions through a shared `carChannel` (with a `ready` gate so no particles spawn while the model is still loading).
  - Kept: donut drift animation (radius 5.2, ω 0.85, 31.5° slip angle + countersteer wobble, body roll/pitch/bounce), GPU point-sprite tire smoke (512-particle ring buffer, custom ShaderMaterial, 240 puffs/s, birth-instant alpha ramp, soft canvas sprite), canvas-generated skid-mark rings on the ground, ContactShadows, drei Environment + Lightformers, star-dot overlays and hero UI from page.tsx.
  - Dropped per-wheel spin/steer pivots: live mesh inspection showed merged tire meshes + misnamed hubs; clustering caused floating/scattering artifacts. Static wheels are imperceptible at hero camera range and the raw model renders perfectly.
  - Camera: fixed cinematic 3/4 wide shot (11, 4.3, 11 → lookAt origin) with pointer parallax and aspect-aware zoom (1.25× tablet, 1.5× portrait phones) so the whole donut stays in frame.
  - Resilience: WebGL context-loss listener auto-remounts the Canvas (scene is deterministic from t=0); `useGLTF.preload`; Suspense inside Canvas; dpr capped at 1.5; ContactShadows at 256.
- page.tsx: added the CC-BY-4.0 attribution line (bottom-left, 10px, white/25) required by the model license.
- Lint: 0 errors / 0 warnings throughout.
- Agent-browser verification & fixes discovered through live screenshots/evals:
  - Fixed smoke `uScale` NaN (`gl.drawingBufferHeight` doesn't exist on WebGLRenderer → `getDrawingBufferSize()`), which had silently disabled all smoke.
  - Fixed smoke trail gap (alpha curve now peaks at birth) and excessive rise (lower vy + buoyancy); softened sprite gradient and grew puffs so the trail reads as a continuous cloud.
  - Gated spawning on car readiness (no "origin puffs" during model load).
  - Confirmed clean render + drift + smoke at 1440×900 / 768×1024 / 375×667; a11y tree intact; CTA/nav untouched; ~2 FPS only under headless SwiftShader (software GL), model is a light 283K verts / 98 meshes for real GPUs.

Stage Summary:
- The hero background is now a real-time 3D scene: the user's gray BMW M5 CS (F90) doing continuous donuts with tire smoke, skid marks and night lighting, self-framing across desktop/tablet/mobile.
- Assets: `public/models/bmw-m5-cs/` (glTF + license); scene component: `src/components/bmw-drift-scene.tsx` (client-only, dynamic import, gradient fallback while loading).
- License compliance: visible "BMW M5 CS (F90) model by fvrenbld · CC-BY-4.0" micro-credit in the hero's bottom-left corner.
- Known artifacts: headless-browser FPS is not representative (software GL); stale error entries in the long-lived browser session predate the fix and do not reproduce on fresh loads.

---
Task ID: 3
Agent: Z.ai Code (main agent)
Task: Rebuild the hero into an interactive, scroll-driven 3D camera experience — pinned viewport, cinematic multi-stage inspection of the gray BMW M5 CS (wide drift pose → low front-bullper focus → rear/diffuser focus → closing wide shot), using vanilla Three.js + GSAP ScrollTrigger (scrub 1.2) + Lenis momentum scrolling.

Work Log:
- Installed gsap@3.15.0 + lenis@1.3.26 (three@0.186 / @types/three already present); imported `lenis/dist/lenis.css` for the required `.lenis` scroll rules.
- Created `src/components/scroll-experience.tsx` (client component owning the fixed canvas + fixed UI overlay + all choreography):
  - Pinned-viewport architecture: fixed full-viewport canvas (z-0) + fixed overlay (z-10) driven by an invisible 440vh scroll track — jitter-free equivalent of ScrollTrigger pinning under Lenis.
  - Camera rig: single `cam` flat state {px..tz} animated by ONE master GSAP timeline (scrub 1.2, `power2.inOut` per act, dwell holds at 0.30–0.42 and 0.72–0.84) and applied every frame via `camera.position.set()` + `camera.lookAt(cam.t*)` so target tracking is always fluid. Timeline doubles as the overlay director (hero copy fade-out, stage captions, closing card).
  - ✏️ MARKED EDIT BLOCK: `KEYS` (hero/front/rear/outro pos+target) with per-key `mobileF` distance multiplier + optional `mobileHeadOn` azimuth factor for portrait; `flattenKey()` adapts keyframes; FOV 45 desktop / 60 mobile via `gsap.matchMedia` (auto rebuild + cleanup on breakpoint crossing).
  - Car: GLTFLoader on the existing `/models/bmw-m5-cs/scene.gltf`; `buildCarRig()` normalizes ANY model (centers footprint, grounds y=0, longest span → 4.6 units) so keyframes fit without retuning; repaints Bodyshell/Bonnet/Boot/DoorColor materials with satin gray clearcoat (#868c93), dark glass, hides showroom plates, enables castShadow; gentle settle-in entrance on load.
  - Studio: canvas vignette backdrop (scene.background) + FogExp2, PMREM RoomEnvironment for reflections (self-contained, no HDR download), warm key SpotLight (shadow map 2K, PCFShadowMap — r186 removed PCFSoftShadowMap), cool rim, hemisphere fill, glossy dark floor + subtle additive light pool, headlight/taillight glow sprites.
  - Presentation garnish: parked drift yaw (−0.14 rad) with idle sway/roll/bounce, pooled 384-particle rear-tire smoke (CPU integration + point-sprite shader; sprite size capped at 300px, near-camera fade via smoothstep so close-up states never flood).
  - Resize: immediate `camera.updateProjectionMatrix()` + `renderer.setSize` + point-scale update, debounced `ScrollTrigger.refresh()` (150ms) for mobile address-bar storms. DPR capped at 2. `prefers-reduced-motion`: Lenis off, scrub instant, sway/smoke disabled.
  - Full teardown: mm.revert + ScrollTrigger.killAll + ticker removal + lenis.destroy + deep scene dispose (geometries/materials/textures) + envTex/pmrem disposal + forceContextLoss + renderer.dispose; async model load guarded by a `disposed` flag.
- Rewrote `src/app/page.tsx` as a thin server wrapper; overlay UI (exact NeuroLink nav/logo, star dots, hero copy/CTA, stage captions, closing card, CC-BY-4.0 attribution) moved into the experience component. Removed now-unused `.hero-shell`/overlay gradient classes from globals.css; deleted superseded `bmw-drift-scene.tsx`.
- Verification & fixes through 3 agent-browser passes (desktop 1440×900 + mobile 390×844, real scroll with scrub settle):
  - Pass 1: choreography proven (front/rear/end/rewind all reached) but paint blew out white, smoke point-sprites flooded close-ups (uncapped size, no near fade), floor reflection washed the lower frame, horizon seam visible → fixed all (env/exposure/key intensity down, smoke size cap + near fade + alpha 0.4, floor darkened, backdrop/fog rebalanced).
  - Pass 2: instrumented runtime state via temporary `window.__scrollDebug` — camera/fov/aspect/progress were EXACTLY as designed; projection of car corners matched the screenshot px-for-px → the "clipped nose" on mobile was the flank sweeping frame-left at a 3/4 angle (aesthetic, not a bug) → added `mobileHeadOn` (front/rear pull toward head-on in portrait) + text-shadow on captions for contrast over the lit floor.
  - Pass 3: mobile front = clean head-on fascia, mobile rear = full diffuser/exhaust profile; fresh-load console 100% clean (shadow warning eliminated via PCFShadowMap), zero page errors, lint 0/0, no horizontal overflow (390=390), reverse scrub rewinds to the exact hero pose with copy restored.

Stage Summary:
- Shipped `src/components/scroll-experience.tsx` + thin `src/app/page.tsx`: a scroll-scrubbed 4-state camera cinematic (hero drift pose → front → rear → outro) that fully rewinds in reverse, with Lenis momentum, pinned fixed-stage architecture, model-agnostic auto-fit, responsive portrait adaptation (FOV 60 + distance/head-on factors) and leak-free teardown.
- Camera coordinates/targets live in one commented `KEYS` block for trivial retuning to any future model; smoke/sway/drift garnish each has a named on/off constant.
- All prior NeuroLink hero elements preserved (nav, star dots, headline, CTA, license credit); superseded R3F drift scene deleted.
- Headless-GPU caveats: model parse takes ~5s under SwiftShader (sub-second on real GPUs) and screenshots can catch mid-scrub poses if taken <1.5s after a scroll jump; both are environment artifacts, not product issues.

---
Task ID: 4
Agent: Z.ai Code (main agent)
Task: Rebrand the entire site from "NeuroLink" (memorial) to "BMW M5 CS" (name, logo, content), then deploy to production on Vercel.

Work Log:
- Located all remaining NeuroLink branding (3D scene already BMW-themed from Task 3; only overlay UI + metadata still NeuroLink).
- Replaced the 129×36 NeuroLink wordmark SVG with a BMW M5 CS lockup: hand-built roundel (black ring, arc-aligned "BMW" letters via SVG textPath, blue/white quadrants), M tricolor stripes (#009ADA / #2B3990 / #E4002B), italic-800 "M5 CS" wordmark inheriting currentColor.
- Rewrote overlay copy: nav links → Overview · Performance · Design · Specs; "Sign In" pill → "Book a Drive"; H1 → "Engineered for the Apex" (white span "the Apex"); subcopy → 627 hp twin-turbo V8 / −70 kg / Nürburgring spec lines; hero CTA → "Explore the M5 CS"; closing card → kicker "BMW M5 CS", headline "The most powerful M5 ever built.", CTA "Reserve Yours". Stage captions (Laserlight & Kidney Grille / Diffuser & Quad Exhaust) were already BMW-correct.
- Rewrote layout.tsx metadata: title "BMW M5 CS — Engineered for the Apex", new description/keywords/OpenGraph (siteName "BMW M5 CS"); removed CDN icon in favor of new `src/app/icon.svg` BMW roundel favicon (App Router file convention).
- Renamed package.json name → "bmw-m5-cs" (used as the Vercel project name); refreshed two stale CSS comments.
- Fixed a self-inflicted broken JSX (logo swap script consumed the old `</svg>`) — caught immediately by lint (parsing error) and repaired.
- Verification: eslint 0/0; local dev 200; agent-browser desktop 1440×900 (hero + full scroll to closing card + reverse rewind restoring hero at opacity 1) and mobile 390×844 (no overflow, 390=390); fresh-load console 100% clean.
- Deployed to Vercel: token validated (`whoami` → 8krm), `vercel link` → project bmw-m5-cs (hobby), `vercel deploy --prod` → build completed in 37s, Ready in 1m.
- Live checks: production URL HTTP 200, correct <title>, /models/bmw-m5-cs/scene.gltf 200, /icon.svg 200, live screenshot renders hero + 3D car with zero page errors.

Stage Summary:
- Site is now fully "BMW M5 CS": logo (roundel + M stripes + M5 CS), nav, hero copy, CTAs, closing card, metadata and favicon all rebranded; 3D scroll experience unchanged.
- Production: https://bmw-m5-cs-vert.vercel.app (alias) — deployment bmw-m5-5zjt5jevy-akrmsalah79-5807s-projects.vercel.app.
- Vercel project "bmw-m5-cs" linked in .vercel/project.json; redeploy anytime with `bunx vercel deploy --prod --token <token>`.

---
Task ID: 5
Agent: Z.ai Code (main agent)
Task: Swap the hand-drawn SVG BMW roundel for the user-uploaded official BMW logo — in both the navbar and the favicon — then redeploy to Vercel.

Work Log:
- Received `upload/BMW.svg.webp` (3840×3840 WebP with alpha, official BMW roundel).
- Converted with sharp: `public/bmw-roundel.png` (192×192, navbar, 28 KB) and `src/app/icon.png` (256×256, favicon); deleted the old hand-built `src/app/icon.svg` so the App Router file convention serves the real logo.
- Updated `src/components/scroll-experience.tsx` navbar lockup: `next/image` (36×36, priority, decorative alt) for the roundel + kept the M tricolor stripe SVG + italic-800 "M5 CS" span; logo anchor is now a flex row (gap-2.5). Added `import Image from 'next/image'`.
- Lint 0/0; local 200; /bmw-roundel.png 200; agent-browser desktop 1440×900 + mobile 390×844: crisp roundel, favicon link = /icon.png, no overflow (390=390), zero page errors.
- Redeployed: `vercel deploy --prod` → Ready in 31s; production alias https://bmw-m5-cs-vert.vercel.app 200; live /bmw-roundel.png 200 (28,568 B) and /icon.png 200; live screenshot confirms the official roundel in the navbar; zero page errors.

Stage Summary:
- Navbar and favicon now use the user's official BMW roundel asset; M stripes + "M5 CS" wordmark unchanged.
- Assets: public/bmw-roundel.png (navbar), src/app/icon.png (favicon). Old SVG roundel fully removed.
- Production live: https://bmw-m5-cs-vert.vercel.app (deployment bmw-m5-aygcigw5s-…).

---
Task ID: 6
Agent: Z.ai Code (main agent)
Task: Replace the indoor studio backdrop with the user's 360° equirectangular lakeside night-city panorama (background + IBL), per the "senior Three.js" spec: ACES/exposure tuning, metallic night reflections, invisible ShadowMaterial floor (opacity 0.55), and retuned scroll camera choreography (hero skyline → front glare → rear bridge), keeping Lenis + scrub 1.2 + mobile FOV handling.

Work Log:
- Optimized `upload/Gemini_Generated_Image_om63vaom63vaom63.jpg` (2912×1440, 2.5 MB) → exact 2:1 `public/environment/night_city_lake_360.jpg` (2560×1280, 228 KB) for correct equirect mapping.
- `src/components/scroll-experience.tsx` — scene integration:
  - Removed canvas studio backdrop, FogExp2, RoomEnvironment, glossy floor + light-pool helpers.
  - ONE TextureLoader panorama → `scene.background` (EquirectangularReflectionMapping, SRGB, anisotropy 8) AND `scene.environment` via `PMREMGenerator.fromEquirectangular` so paint reflections match the visible photo; clear-color fallback while it streams.
  - `scene.backgroundRotation`/`environmentRotation` kept identical: `ENV_ROTATION_Y=-0.19` (empirically calibrated: skyline behind hero, bridge behind rear, harbour behind front) + `BACKDROP_PITCH_X=0.12` (raises the photographic ground to meet the 3D floor).
  - ACESFilmicToneMapping kept; exposure 1.0 → 1.15.
  - Lights → night grade: key SpotLight 0xdfe9ff @ (3,14,4) steep for tight tire contact shadows, rim 0x9fc0ee 2.4, hemisphere 0x27364e/0x0a0c10 0.5; paint envMapIntensity 0.85→1.25, glass →1.3; headlight/taillight glow sprites boosted for night glare.
  - Floor → invisible `ShadowMaterial({ opacity: 0.55 })` shadow-catcher only.
  - Smoke retuned for close-ups: 384→240 particles, 220→105 puffs/s, point cap 300→190 px, ×0.7 night alpha.
  - Teardown: dispose panorama + PMREM RT, null background/environment (no leaks).
- Camera keys retuned (world units, car at origin nose +X):
  - hero (-6.1, 1.5, 4.3) → (0, 0.75, 0) — low rear-3/4 stance, bridge left + skyline right.
  - front (4.4, 0.5, 2.1) → (2.0, 0.52, 0) — low nose close-up, headlight glare, harbour glow behind.
  - rear (-4.3, 0.9, 2.2) → (-1.9, 0.68, 0) — taillights/diffuser against the glowing bridge line.
  - outro (-6.9, 3.1, 7.2) → (0, 1.15, 0) — aim lifted so the bridge stays in the closing card.
  - Caption copy updated ("glowing bridge line", "harbour glow"); canvas aria-label → lakeside inspection.
- Verified: lint 0/0; desktop sequence hero/front/rear/outro + full rewind (hero opacity 1); mobile 390×844 (FOV 60 + distance factors, 390=390 no overflow); fresh-load console clean.
- Deployed: `vercel deploy --prod` → Ready 37s, aliased https://bmw-m5-cs-vert.vercel.app; live panorama HTTP 200 (233,156 B); live screenshots confirm the night scene + car; zero page errors.

Stage Summary:
- The 3D stage is now a real-world lakeside night set: 360° photo backdrop = IBL, invisible shadow-catcher floor, night-graded lights, tuned scrub choreography — all keyframe/rotation constants documented in-file (KEYS block + ENV_ROTATION_Y/BACKDROP_PITCH_X).
- Production: https://bmw-m5-cs-vert.vercel.app (deployment bmw-m5-bn49qtih2-…).
- Known note: first load streams the 13 MB glTF — the car pops in after parse (fallback gradient/clear color shows the panorama immediately); subsequent loads are instant (cached).

---
Task ID: 7
Agent: Z.ai Code (main agent)
Task: Revert the environment direction per user correction — replace the lakeside night panorama with the user's 360° equirectangular STUDIO panorama ('studio_360.jpg') as scene.background + scene.environment, restore ShadowMaterial opacity 0.4, retune the scroll camera sequence (low-angle hero → front bumper zoom → rear diffuser orbit), scrub 1.2, 300vh track, mobile FOV on resize.

Work Log:
- Identified the correct upload: Gemini_Generated_Image_q2yuwoq2yuwoq2yu.jpg (2912×1440 ≈ 2:1 equirect; the sm41dq… file was the flat perspective reference). sharp → exact 2:1 `public/textures/studio_360.jpg` (2048×1024, 182 KB); removed the now-unused `public/environment/night_city_lake_360.jpg`.
- `src/components/scroll-experience.tsx` — studio integration (ENV_URL swap + rename lakeTex→studioTex, lakeEnvRT→studioEnvRT):
  - ONE TextureLoader panorama → scene.background (EquirectangularReflectionMapping, SRGB, anisotropy 8) AND scene.environment via PMREMGenerator.fromEquirectangular → paint reflects the real softbox/walls; ACESFilmicToneMapping exposure 1.15 → 1.05 (softbox whites short of clipping); fallback clear 0x0a0b0d.
  - Rotations: ENV_ROTATION_Y 0 (softbox centered +X), BACKDROP_PITCH_X −0.25 → +0.1 after visual tuning (negative pulled the ceiling into frame; positive plants the photo floor at y=0 and keeps the softbox peeking at the top).
  - Lights regraded from night to studio: key SpotLight 0xdfe9ff@340 (3,14,4) → 0xf5f8ff@190 overhead (0.4, 9, 1.2) wide-angle/penumbra 0.9 — shadow pools straight under the tires; rim 0x9fc0ee 2.4 → 0xe8edf4 1.1 neutral fill; hemisphere 0.5 night → 0.5 neutral 0x3d434b/0x131518.
  - Floor: ShadowMaterial opacity 0.55 → 0.4, radius 90 → 60 (photo concrete is the visible floor).
  - Paint retuned for the dark-walled studio: metalness 0.82 → 0.7, envMapIntensity 1.25 → 1.55 (glass 1.3 → 1.5, trims 0.7 → 0.9) — car was otherwise near-invisible reflecting black cyc walls.
  - Camera KEYS retuned: hero (-6.1,1.5,4.3) → LOW (-6.0,0.78,4.7)→(0,0.78,0); front (4.4,0.5,2.1) → tighter (3.55,0.52,1.5)→(2.1,0.5,0.05); rear (-4.3,0.9,2.2) → (-3.95,0.66,1.75)→(-2.0,0.58,0); outro (-6.9,3.1,7.2) → (-6.6,2.6,6.8)→(0,1.0,0). scrub already 1.2; scroll track 440vh → 300vh per spec.
  - Removed night-only garnish: STAR_DOTS overlay + starDotStyle + CSSProperties import (stars make no sense indoors); captions updated (softbox / studio key light); aria-label → studio inspection.
- Verified: lint 0/0; agent-browser desktop 1440×900 full sequence (hero low-angle drift → front close-up with Laserlight/kidneys → rear 3/4 diffuser+quad+smoke → outro end card → full reverse rewind restoring hero); mobile 390×844 (FOV 60 + mobileF, head-on front crop); zero console/page errors; first-load note: 13 MB glTF parse leaves ~8 s of panorama-only view before the car pops in.
- Deployed: `vercel deploy --prod` → aliased https://bmw-m5-cs-vert.vercel.app; live /textures/studio_360.jpg 200 (185,776 B); live screenshots confirm studio hero + front close-up with car; zero page errors.

Stage Summary:
- The 3D stage is now a photographic light studio: 360° softbox panorama drives both backdrop and IBL, invisible 0.4 shadow-catcher floor, studio-graded lights, low-angle→front→rear scrub choreography on a 300vh track — every tweakable (KEYS, ENV_ROTATION_Y, BACKDROP_PITCH_X, FOV_*, exposure) documented in-file.
- Production: https://bmw-m5-cs-vert.vercel.app (deployment bmw-m5-lkxz58sfz-…).

---
Task ID: 8
Agent: Z.ai Code (main agent)
Task: Revert to commit 18c6105 (lakeside night 360 backdrop) per user request, then fix the two user-reported defects: (1) the car floated above the photo ground in hero/front/rear shots (only the outro framing looked parked), (2) the 360° panorama showed only one district — camera transitions did not reveal other parts of the image.

Work Log:
- Restored `src/components/scroll-experience.tsx` + `public/environment/night_city_lake_360.jpg` from 18c6105; deleted `public/textures/studio_360.jpg` (Task 7 direction rolled back).
- Root-cause analysis: (a) floating = low, level cameras put the panorama's water/quay band behind the wheels; grounding only works when the camera is raised and tilted down (like the approved outro), because the wheels (finite distance) must project BELOW the photo's railing line (infinite skybox); (b) static backdrop = hero/rear/outro cameras all sat in the same ~135-155° azimuth quadrant, so all three dwelled on the same bridge view.
- Tried and REMOVED a visible 3D asphalt disc (radius 16 → 4.2 iterations): it always read as a dark podium pasted over the photo's parking lines; grounding must come from camera geometry, not a visible floor. Kept the invisible ShadowMaterial catcher (r 7, opacity 0.45) with an in-file warning not to grow it into a disc.
- New choreography in `scroll-experience.tsx` (all ✏️-commented): hero (-6.8,2.2,4.8)→(0,0.58,0) elevated 3/4, bridge+skyline backdrop, grounded; front (4.35,1.35,3.35)→(1.75,0.45,0.28) raised from the old 0.5 bumper-cam, silo/water backdrop; NEW waypoints mid1 (5.2,1.22,-2.7) + mid2 (-1.7,1.7,-4.7) arc the lens around the nose and right-rear corner (straight front→rear tween clipped the body); rear (-6.0,2.6,3.2)→(-1.85,0.5,0) — three right-side rear variants floated over the skyline band's 10 m-wide quay walkway, so rear returns to the quay-LEFT side where the railing is close and the lot runs to the tires; outro unchanged (user-approved). Act II split into three 0.1-duration tweens (0.42/0.52/0.62) — the journey sweeps the panorama ~245° (silos → road → port cranes → skyline → bridge).
- Added optional per-shot `fov` to CamKey/FlatKey: GSAP-tweened `fo` applied in applyCamera() (updateProjectionMatrix only on change); rear uses fov 50; BACKDROP_PITCH_X 0.12 → 0.06 for tower headroom; lint 0/0 throughout.
- Verified via agent-browser on localhost (1440×900): hero/front/mid-flank/rear/outro + 1750px mid-transition (port-cranes flank shot, no body clipping) + reverse scroll; mobile 390×844 hero/front/rear grounded with FOV 60 + mobileF; fresh-load console clean (the WebGL 'precision' error was a stale dev-only Fast Refresh artifact).
- Deployed `vercel deploy --prod` → https://bmw-m5-cs-vert.vercel.app (HTTP 200, title OK); live screenshots confirm hero (bridge, grounded), rear (lot asphalt + benches + water), front (silo district); committed as git revert + choreography commit.

Stage Summary:
- Both user defects fixed and live: the car is parked ON the wet lot asphalt in all four dwell states (wheels below the quay line, real contact shadow), and each scroll transition now pans a different district of the 360° photo (bridge → silos/water → cranes/skyline flank → bridge), with the panorama fully swept across the journey.
- Camera grounding rules documented in-file (GROUNDING RULE + GROUNDING CHEAT-SHEET + per-key comments): raise pos[1], aim target[1] low, keep distance ≥4.5, spread azimuths, use per-shot fov; rear must stay on the quay-left side.
- Production: https://bmw-m5-cs-vert.vercel.app

---
Task ID: 9
Agent: Z.ai Code (main agent)
Task: Per user feedback on the live Task 8 build — (1) hero: the car clipped into the quay curb and read too small; make the car BIG with the city clearly visible in front of it, (2) in the remaining sections the "zoom-ins" must feel like a wide 0.4× phone-camera zoom so the 360° city stays clearly visible instead of being cropped away.

Work Log:
- Root cause: Task 8's hero stood 8.3 u back on a 45° lens (small car; its front overlapped the bench/quay line = "داخلة بالرصيف"), and the front dwell (d 4.1, fov 45) cropped the city out entirely — a narrow telephoto zoom kills the 360° context.
- New rule added to the in-file GROUNDING CHEAT-SHEET: WIDE LENS RULE — when a shot moves close to the car, widen `fov` (60–66) instead of cropping tighter; wide lens keeps the city readable around a big car.
- KEYS retuned (all ✏️-commented): hero pos [-6.8,2.2,4.8]→[-4.75,2.4,3.35], target y 0.58→0.48, fov 56 — car ~40% bigger, contact point ~7° further below the quay line (curb fixed), bridge+skyline fully visible above. front [4.35,1.35,3.35]→[5.0,2.3,3.85], fov 66 (ultra-wide 0.4× look; iterated 1.42→1.75→2.05→2.3 height via screenshots until the wheels landed on the lined asphalt instead of the walkway). mid1 y 1.22→1.5 fov 62; mid2 y 1.7→2.1 fov 64 (side-profile float fixed); rear [-6.0,2.6,3.2]→[-6.3,2.5,3.35] fov 60. outro untouched (user-approved).
- CamKey semantics: per-shot `fov` is now DESKTOP-only (portrait already uses wide FOV_MOBILE 60; new optional `fovMobile` override added to type + flattenKey) — verified hero/front/rear on 390×844: big grounded car, city clear, no cropping.
- Verified localhost via agent-browser: desktop 1440×900 sequence hero → front (0.389) → head-on mid (0.47) → cranes side profile (0.57) → rear (0.80) → outro (1.0) → reverse rewind; all grounded, city visible in every dwell, no body clipping, no new console errors (only the known dev-only Fast Refresh WebGL artifact). lint 0/0. Committed c998738.
- Deploy BLOCKED: Vercel CLI session lost its credentials between sessions (`vercel whoami` → Logged out; no token in env/dotfiles/tool-results). `bunx vercel deploy --prod` errors with "No existing credentials found". Needs `vercel login` or `--token <TOKEN>` from the user; project link (.vercel/project.json → bmw-m5-cs) is intact so a token deploy will hit the same domain.

Stage Summary:
- All three user complaints fixed locally and browser-verified: hero = BIG grounded car with the bridge/skyline city clearly in front, no curb clipping; every close-up now uses the wide 0.4×-style lens (fov 60–66 desktop) so the 360° city stays readable throughout the scroll; transitions (head-on nose, cranes side profile) equally grounded.
- Production NOT updated this round: Vercel auth expired in this sandbox — run `bunx vercel login` yourself or hand me a token and I'll `bunx vercel deploy --prod --token …` immediately (code is committed at c998738, ready to ship).
