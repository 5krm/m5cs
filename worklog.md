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
