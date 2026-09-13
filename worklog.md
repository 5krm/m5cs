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
