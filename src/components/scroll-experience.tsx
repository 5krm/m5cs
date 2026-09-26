'use client'

/**
 * ═════════════════════════════════════════════════════════════════════════
 * ScrollExperience — scroll-driven 3D camera inspection (gray BMW M5 CS)
 * ═════════════════════════════════════════════════════════════════════════
 * Stack: vanilla three.js · GSAP + ScrollTrigger (scrub 1.2) · Lenis
 *
 * Choreography (scrubbed 1:1 with scroll — reverses fluidly when scrolling
 * back up, because everything is one timeline driven by ScrollTrigger):
 *
 *   progress   camera move                          overlay
 *   ─────────────────────────────────────────────────────────────────────
 *   0.00–0.24  HERO → FRONT   wide drift pose →    hero copy fades out
 *                             low, tight nose      front caption in/out
 *   0.34–0.56  FRONT → REAR   sweep along flank    rear caption in/out
 *   0.66–0.78  REAR → XRAY    high side profile,   car turns into a wireframe
 *                             scan-line sweep      "X-ray", spec counters tick up
 *   0.88–1.00  XRAY → OUTRO   pull back wide       closing card fades in
 *
 * Backdrop: a procedural 3D showroom — cyclorama wall with panel seams and a
 * warm horizon glow, overhead softbox strips, distant light pillars (with
 * floor reflections), floor runway lines, a volumetric light shaft with
 * drifting dust motes and a dark reflective floor (mirrored-car double
 * trick) — no image assets at all. No smoke, no sway: the car reads parked
 * and grounded (real cast shadow + body AO + per-wheel contact patches).
 *
 * Loading: the meshopt-compressed GLB (3.2 MB vs 12.7 MB) is fetched with
 * a stream reader so the branded overlay shows the REAL byte %, then
 * fades once the model parses (min 0.8 s hold so it never flashes).
 *
 * The "pinned viewport" is a fixed full-viewport stage (canvas + UI
 * overlay) driven by an invisible 560vh scroll track — functionally a
 * ScrollTrigger pin, but perfectly jitter-free with Lenis on every browser.
 */

import { useEffect, useRef, useState, useCallback } from 'react'
import type { CSSProperties } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { MeshoptDecoder } from 'meshoptimizer/decoder'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import Lenis from 'lenis'
import 'lenis/dist/lenis.css'
import {
  StudioTheme,
  PaintFinish,
  WheelFinish,
  CaliperColor,
  SceneId,
  MMode,
  PAINT_CONFIGS,
  WHEEL_CONFIGS,
  CALIPER_CONFIGS,
  SPEC_STATS,
  COCKPIT_CALLOUTS,
  getInitialSceneId,
  getRandomSceneId,
} from '@/types/configurator'
import ConfiguratorDock from '@/components/configurator-dock'
import CockpitOverlay from '@/components/cockpit-overlay'
import { buildLocationScene, STUDIO_LIGHTING, type LocationLighting, type LocationScene } from '@/lib/locations'

export type { StudioTheme, PaintFinish, WheelFinish, CaliperColor }
export { PAINT_CONFIGS, WHEEL_CONFIGS, CALIPER_CONFIGS }

/* ═════════════════ 1. MODEL ══════════════════════════════════════════ */

const MODEL_URL = '/models/bmw-m5-cs/scene.min.glb' // CC-BY-4.0 · fvrenbld — meshopt-compressed (3.2 MB)
const TARGET_LENGTH = 4.6 // car is normalized to this world length
const FLIP_MODEL = false // set true if a swapped model faces backwards

/** Showroom floor reflection — mirrored car double (desktop only) */
const FLOOR_REFLECTION = true

/* ═══════════ 2. CAMERA KEYFRAMES — ✏️ EDIT HERE ══════════════════════
 * World space: car sits at the origin, nose pointing +X, ~4.6 units long,
 * ~1.45 tall; the ground plane is y = 0.
 *
 *   pos[]    camera position [x, y, z]
 *   target[] lookAt target [x, y, z] — tracked via camera.lookAt() in the
 *            render loop so target tracking stays perfectly fluid
 *   mobileF  camera-distance multiplier on portrait screens (mobile also
 *            widens FOV 45 → 60, see FOV_*). The offset from pos → target
 *            is scaled by this factor, so the framing angle is preserved.
 */
type Vec3 = [number, number, number]
type CamKey = {
  pos: Vec3
  target: Vec3
  mobileF: number
  /** portrait only: multiplies the lateral (z) camera offset again so the
   *  close-ups read more head-on — keeps the car flank out of the frame */
  mobileHeadOn?: number
  /** portrait only: a completely separate pose (used when scaling the
   *  desktop offset would not frame the subject sensibly) */
  mobile?: { pos: Vec3; target: Vec3 }
}

const KEYS = {
  /** 0% — wide drifting presentation, slightly high 3/4 iso */
  hero: { pos: [7.2, 2.9, 7.4], target: [0, 0.55, 0], mobileF: 1.35 },
  /** state 1 — dramatic low angle on the front bumper / headlights */
  front: { pos: [4.4, 0.5, 2.1], target: [2.0, 0.52, 0], mobileF: 2.15, mobileHeadOn: 0.45 },
  /** state 2 — rear taillights, diffuser and exhaust, same-side sweep */
  rear: { pos: [-4.3, 0.9, 2.2], target: [-1.9, 0.68, 0], mobileF: 2.0, mobileHeadOn: 0.45 },
  /** state 3 — X-ray: elevated broadside so the whole chassis fits the frame
   *  while the spec panel sits on the right */
  xray: {
    pos: [-0.1, 2.0, 7.9],
    target: [0.95, 0.6, 0],
    mobileF: 1.55,
    // portrait: broadside from further out, car pushed into the top half
    // so the spec strip along the bottom never covers it
    mobile: { pos: [0.3, 2.4, 10.2], target: [0.2, -0.9, 0] },
  },
  /** closing wide elevated rear 3/4 for the end card */
  outro: { pos: [-6.9, 3.1, 7.2], target: [0, 0.55, 0], mobileF: 1.35 },
} satisfies Record<string, CamKey>

const FOV_DESKTOP = 45
const FOV_MOBILE = 60

/* ═════ 3. PRESENTATION GARNISH (parked stance) ═══════════════════════ */

const BASE_YAW = -0.14 // parked "drift" angle of the car (rad)

/* ══════════════════════════════════════════════════════════════════════
 * Canvas-generated textures — zero network dependencies
 * ══════════════════════════════════════════════════════════════════════ */

/** Soft dark ellipse under the car — the fake-AO contact shadow */
function makeContactShadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 256
  const ctx = canvas.getContext('2d')!
  const g = ctx.createRadialGradient(128, 128, 10, 128, 128, 128)
  g.addColorStop(0, 'rgba(0,0,0,0.62)')
  g.addColorStop(0.5, 'rgba(0,0,0,0.34)')
  g.addColorStop(0.8, 'rgba(0,0,0,0.1)')
  g.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 256, 256)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** One wheel's contact patch — darker and tighter than the body blob */
function makeWheelShadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 128
  const ctx = canvas.getContext('2d')!
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 64)
  g.addColorStop(0, 'rgba(0,0,0,0.9)')
  g.addColorStop(0.4, 'rgba(0,0,0,0.55)')
  g.addColorStop(0.75, 'rgba(0,0,0,0.18)')
  g.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 128, 128)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** Tiny soft sprite for the air-dust motes drifting in the light shaft */
function makeDustSpriteTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 32
  const ctx = canvas.getContext('2d')!
  const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.4, 'rgba(255,255,255,0.5)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 32, 32)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** Dark seamless studio vignette used as scene.background */
function makeStudioBackdropTexture(theme: StudioTheme = 'apex'): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 1024
  const ctx = canvas.getContext('2d')!
  const g = ctx.createRadialGradient(512, 430, 40, 512, 512, 780)
  if (theme === 'm') {
    g.addColorStop(0, '#10162a')
    g.addColorStop(0.48, '#0b0f1c')
    g.addColorStop(1, '#03050a')
  } else if (theme === 'night') {
    g.addColorStop(0, '#0a1524')
    g.addColorStop(0.48, '#060c16')
    g.addColorStop(1, '#020408')
  } else {
    g.addColorStop(0, '#202430')
    g.addColorStop(0.48, '#11131a')
    g.addColorStop(1, '#050608')
  }
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 1024, 1024)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** Warm pool of showroom light on the floor under the car */
function makeFloorPoolTexture(theme: StudioTheme = 'apex'): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 256
  const ctx = canvas.getContext('2d')!
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128)
  if (theme === 'm') {
    g.addColorStop(0, 'rgba(0, 154, 218, 0.85)')
    g.addColorStop(0.42, 'rgba(43, 57, 144, 0.25)')
    g.addColorStop(1, 'rgba(0, 0, 0, 0)')
  } else if (theme === 'night') {
    g.addColorStop(0, 'rgba(137, 207, 240, 0.85)')
    g.addColorStop(0.45, 'rgba(100, 160, 220, 0.22)')
    g.addColorStop(1, 'rgba(0, 0, 0, 0)')
  } else {
    g.addColorStop(0, 'rgba(255, 244, 224, 0.9)')
    g.addColorStop(0.45, 'rgba(255, 244, 224, 0.28)')
    g.addColorStop(1, 'rgba(255, 244, 224, 0)')
  }
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 256, 256)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** Cyclorama wall — "infinity cove" 360° studio architecture with recessed LED light columns
 *  and seamless horizon glow band. */
function makeCycloramaTexture(theme: StudioTheme = 'apex'): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 2048
  canvas.height = 1024
  const ctx = canvas.getContext('2d')!

  const g = ctx.createLinearGradient(0, 0, 0, 1024)
  g.addColorStop(0, '#040508') // fog top
  g.addColorStop(0.45, '#07090e')
  g.addColorStop(0.72, '#0e111a')

  if (theme === 'm') {
    g.addColorStop(0.86, '#0f1728')
    g.addColorStop(0.95, '#172745') // electric M blue lift
    g.addColorStop(1, '#070a12')
  } else if (theme === 'night') {
    g.addColorStop(0.86, '#0b1422')
    g.addColorStop(0.95, '#132236') // deep sapphire lift
    g.addColorStop(1, '#05070c')
  } else {
    g.addColorStop(0.86, '#211a12')
    g.addColorStop(0.95, '#3e311b') // warm golden apex glow
    g.addColorStop(1, '#0a0c10')
  }

  ctx.fillStyle = g
  ctx.fillRect(0, 0, 2048, 1024)

  // Architectural panel seams
  ctx.strokeStyle = 'rgba(255,255,255,0.024)'
  ctx.lineWidth = 1.5
  for (let x = 64; x < 2048; x += 128) {
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, 1024)
    ctx.stroke()
  }

  // Recessed perimeter vertical LED accent pillars
  for (let x = 128; x < 2048; x += 256) {
    const colG = ctx.createLinearGradient(x - 36, 0, x + 36, 0)
    const glowColor =
      theme === 'm'
        ? (x % 512 === 0 ? 'rgba(0, 154, 218, ' : 'rgba(228, 0, 43, ')
        : theme === 'night'
        ? 'rgba(137, 207, 240, '
        : 'rgba(255, 228, 185, '

    colG.addColorStop(0, glowColor + '0)')
    colG.addColorStop(0.5, glowColor + '0.12)')
    colG.addColorStop(1, glowColor + '0)')

    ctx.fillStyle = colG
    ctx.fillRect(x - 36, 180, 72, 844)

    // Inner bright core
    ctx.fillStyle = glowColor + '0.35)'
    ctx.fillRect(x - 2, 260, 4, 730)
  }

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** Soft vertical falloff for the volumetric light shaft */
function makeLightShaftTexture(theme: StudioTheme = 'apex'): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 256
  const ctx = canvas.getContext('2d')!
  const g = ctx.createLinearGradient(0, 0, 0, 256)
  if (theme === 'm') {
    g.addColorStop(0, 'rgba(0, 154, 218, 0.85)')
    g.addColorStop(0.55, 'rgba(43, 57, 144, 0.26)')
    g.addColorStop(1, 'rgba(0, 0, 0, 0)')
  } else if (theme === 'night') {
    g.addColorStop(0, 'rgba(160, 220, 255, 0.85)')
    g.addColorStop(0.55, 'rgba(100, 170, 240, 0.25)')
    g.addColorStop(1, 'rgba(0, 0, 0, 0)')
  } else {
    g.addColorStop(0, 'rgba(255, 243, 222, 0.9)')
    g.addColorStop(0.55, 'rgba(255, 238, 214, 0.32)')
    g.addColorStop(1, 'rgba(255, 235, 210, 0)')
  }
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 64, 256)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** Precision high-tech floor texture with obsidian tarmac, concentric distance rings,
 *  BMW M tri-color calibration indices, coordinate crosshairs, and Munich GPS telemetry */
function makeHighTechFloorTexture(theme: StudioTheme = 'apex'): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 2048
  const ctx = canvas.getContext('2d')!
  const cx = 1024
  const cy = 1024

  // Obsidian base
  const bg = ctx.createRadialGradient(cx, cy, 120, cx, cy, 1020)
  bg.addColorStop(0, '#0a0d14')
  bg.addColorStop(0.5, '#07080e')
  bg.addColorStop(0.85, '#040508')
  bg.addColorStop(1, '#020305')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, 2048, 2048)

  // Procedural micro-grit for tarmac realism
  const imgData = ctx.getImageData(0, 0, 2048, 2048)
  const d = imgData.data
  for (let i = 0; i < d.length; i += 32) {
    const noise = (Math.random() - 0.5) * 8
    d[i] = Math.max(0, Math.min(255, d[i] + noise))
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + noise))
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + noise + 1))
  }
  ctx.putImageData(imgData, 0, 0)

  // Sub-grid lines (64px)
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.024)'
  ctx.lineWidth = 1
  for (let x = 0; x <= 2048; x += 64) {
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, 2048)
    ctx.stroke()
  }
  for (let y = 0; y <= 2048; y += 64) {
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(2048, y)
    ctx.stroke()
  }

  // Major grid lines (256px)
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.055)'
  ctx.lineWidth = 1.5
  for (let x = 0; x <= 2048; x += 256) {
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, 2048)
    ctx.stroke()
  }
  for (let y = 0; y <= 2048; y += 256) {
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(2048, y)
    ctx.stroke()
  }

  // Concentric chassis calibration rings
  const ringColor =
    theme === 'm'
      ? 'rgba(0, 154, 218, 0.16)'
      : theme === 'night'
      ? 'rgba(137, 207, 240, 0.16)'
      : 'rgba(255, 228, 185, 0.16)'

  const rings = [140, 260, 420, 620, 840]
  rings.forEach((r, idx) => {
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.strokeStyle = idx === 1 || idx === 3 ? ringColor : 'rgba(255, 255, 255, 0.04)'
    ctx.lineWidth = 1.2
    if (idx % 2 === 1) {
      ctx.setLineDash([4, 8])
    } else {
      ctx.setLineDash([])
    }
    ctx.stroke()
  })
  ctx.setLineDash([])

  // Radial degree tick marks on outer ring (r = 840)
  const outerR = 840
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)'
  ctx.lineWidth = 1
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 36) {
    const isMajor = a % (Math.PI / 6) < 0.01
    const len = isMajor ? 16 : 8
    const cos = Math.cos(a)
    const sin = Math.sin(a)
    ctx.beginPath()
    ctx.moveTo(cx + cos * (outerR - len), cy + sin * (outerR - len))
    ctx.lineTo(cx + cos * outerR, cy + sin * outerR)
    ctx.stroke()
  }

  // BMW M tri-color accent notches on middle ring (r = 420)
  const mR = 420
  const mColors = ['#009ADA', '#2B3990', '#E4002B']
  const angles = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]
  angles.forEach((baseAngle) => {
    mColors.forEach((col, cIdx) => {
      const a = baseAngle + (cIdx - 1) * 0.035
      ctx.beginPath()
      ctx.arc(cx, cy, mR, a - 0.012, a + 0.012)
      ctx.strokeStyle = col
      ctx.lineWidth = 3
      ctx.stroke()
    })
  })

  // Precision typography & telemetry indicators
  ctx.font = '10px monospace'
  ctx.fillStyle = ringColor
  ctx.textAlign = 'center'
  ctx.fillText('BMW M DIVISION // 48.1767° N, 11.5583° E // APEX CALIBRATION', cx, cy - 280)
  ctx.fillText('M5 CS // TWIN-TURBO 4.4L V8 // 627 HP // LIGHTWEIGHT BENCH', cx, cy + 300)

  // Alignment crosshairs at major intersections
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)'
  ctx.lineWidth = 1
  for (let x = 512; x <= 1536; x += 256) {
    for (let y = 512; y <= 1536; y += 256) {
      const arm = 6
      ctx.beginPath()
      ctx.moveTo(x - arm, y)
      ctx.lineTo(x + arm, y)
      ctx.moveTo(x, y - arm)
      ctx.lineTo(x, y + arm)
      ctx.stroke()
    }
  }

  // Radial border vignette
  const edgeGrad = ctx.createRadialGradient(cx, cy, 700, cx, cy, 1024)
  edgeGrad.addColorStop(0, 'rgba(4, 5, 8, 0)')
  edgeGrad.addColorStop(0.8, 'rgba(4, 5, 8, 0.65)')
  edgeGrad.addColorStop(1, 'rgba(2, 3, 5, 1)')
  ctx.fillStyle = edgeGrad
  ctx.fillRect(0, 0, 2048, 2048)

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** Forward laserlight beam projection cast on floor */
function makeHeadlightProjectionTexture(theme: StudioTheme = 'apex'): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 256
  const ctx = canvas.getContext('2d')!
  const g = ctx.createRadialGradient(80, 128, 10, 260, 128, 240)
  const col =
    theme === 'night'
      ? '160, 215, 255'
      : theme === 'm'
      ? '0, 170, 255'
      : '255, 235, 195'
  g.addColorStop(0, `rgba(${col}, 0.65)`)
  g.addColorStop(0.35, `rgba(${col}, 0.25)`)
  g.addColorStop(0.7, `rgba(${col}, 0.06)`)
  g.addColorStop(1, `rgba(${col}, 0)`)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 512, 256)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** Rear diffuser crimson glow pool cast on floor */
function makeTaillightProjectionTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 256
  const ctx = canvas.getContext('2d')!
  const g = ctx.createRadialGradient(432, 128, 10, 252, 128, 240)
  g.addColorStop(0, 'rgba(235, 20, 40, 0.55)')
  g.addColorStop(0.38, 'rgba(200, 15, 30, 0.22)')
  g.addColorStop(0.75, 'rgba(140, 10, 20, 0.05)')
  g.addColorStop(1, 'rgba(80, 0, 10, 0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 512, 256)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/* ══════════════════════════════════════════════════════════════════════
 * Car — load the real glTF, normalize + restyle it
 * ══════════════════════════════════════════════════════════════════════ */

/** glTF material names that carry the body paint / glass (fvrenbld model) */
const BODY_PAINT = new Set(['Bodyshell1Mtl', 'Bonnet0041Mtl', 'Bonnet1Mtl', 'Boot0041Mtl', 'DoorColor1Mtl'])
const GLASS = new Set(['Windowrf1Mtl'])

const darkGlass = () =>
  new THREE.MeshPhysicalMaterial({
    color: '#06080b',
    metalness: 0.55,
    roughness: 0.1,
    clearcoat: 1,
    clearcoatRoughness: 0.06,
    envMapIntensity: 1.05,
  })

type CarRig = {
  car: THREE.Group
  paintMaterials: THREE.MeshPhysicalMaterial[]
  setHoodOpen: (open: boolean) => void
  setDoorOpen: (open: boolean) => void
  setWheelFinish: (finish: WheelFinish) => void
  setCaliperColor: (color: CaliperColor) => void
  setPaintColor: (paint: PaintFinish) => void
  /** 0 = normal paint, 1 = full wireframe X-ray (body shell fades to a
   *  translucent blue-print, drivetrain + chassis stay lit) */
  setXray: (amount: number) => void
  /** cockpit mode: hides the body shell / glass that would sit between the
   *  driver's-eye camera and the interior, and paints the cluster red */
  setCockpit: (active: boolean, mode: MMode) => void
  /** driver's-eye position in car-local space */
  cockpitEye: THREE.Vector3
}

/* Materials that belong to the drivetrain / chassis — they stay solid during
 * the X-ray so the car reads as "skin removed", not "car removed". */
const XRAY_KEEP = /^(Engineblock|Chassis|Meshesrotor|Hubr|Meshestires|Misca0021|RoundedRectangle|60galFuelTank)/
/* Interior + cabin materials — solid during X-ray, and the ONLY meshes left
 * fully visible while sitting in the cockpit. */
const CABIN = /^(Interior|Seats|Steeringwheel|Needle|Miscdash|Miscseatbelts|Meshpart|Part|VehicleMobilePhoneHolder|LicensePlate1Mtl|Misca1Mtl|Miscb1Mtl|Miscdoorr1Mtl)/
/* Dashboard cluster / dials — get an emissive M-mode tint in the cockpit */
const CLUSTER = /^(Needle|Miscdash)/
/* Dash clutter shipped with the source model (a cartoon figurine and a
 * phone cradle + its bracket parts) — not M5 CS equipment, always hidden. */
const CLUTTER = /^(Minion|VehicleMobilePhoneHolder|Meshpart|Part1Mtl)/
/* Anything tiny (< 20 cm) perched on the dash top at the phone-mount spot
 * (car-local x≈0.55, y≈1.0) is part of that same clutter — caught by
 * position so renamed sub-parts never slip through. */
const CLUTTER_ZONE = { x: [0.42, 0.72], y: [0.9, 1.12], z: [-0.3, -0.05], maxSize: 0.2 }

function makeCarbonFiberTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.fillStyle = '#101215'
    ctx.fillRect(0, 0, 64, 64)
    ctx.fillStyle = '#22252a'
    ctx.fillRect(0, 0, 32, 32)
    ctx.fillRect(32, 32, 32, 32)
    ctx.fillStyle = '#181a1e'
    ctx.fillRect(32, 0, 32, 32)
    ctx.fillRect(0, 32, 32, 32)
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(24, 24)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

function inClutterZone(mesh: THREE.Mesh): boolean {
  // mesh is already scaled/positioned inside the normalized model group
  const b = new THREE.Box3().setFromObject(mesh)
  const size = b.getSize(new THREE.Vector3())
  if (Math.max(size.x, size.y, size.z) > CLUTTER_ZONE.maxSize) return false
  const c = b.getCenter(new THREE.Vector3())
  const Z = CLUTTER_ZONE
  return c.x > Z.x[0] && c.x < Z.x[1] && c.y > Z.y[0] && c.y < Z.y[1] && c.z > Z.z[0] && c.z < Z.z[1]
}

/**
 * Normalizes car glTF, creates articulation pivots for hood and doors,
 * and sets up materials for wheels, carbon-ceramic calipers, and carbon fiber.
 */
function buildCarRig(
  source: THREE.Object3D,
  initialPaint: PaintFinish = 'brands-hatch-grey',
  initialWheel: WheelFinish = 'gold-bronze',
  initialCaliper: CaliperColor = 'red'
): CarRig {
  const model = source.clone(true)

  const box = new THREE.Box3().setFromObject(model)
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  const scale = TARGET_LENGTH / Math.max(size.x, size.z)
  model.scale.setScalar(scale)
  model.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale)
  if (FLIP_MODEL) model.rotation.y = Math.PI

  const car = new THREE.Group()
  car.add(model)
  car.updateMatrixWorld(true)

  const paintMaterials: THREE.MeshPhysicalMaterial[] = []
  const cfg = PAINT_CONFIGS[initialPaint]
  const basePaint = new THREE.MeshPhysicalMaterial({
    color: cfg.hex,
    metalness: cfg.metalness,
    roughness: cfg.roughness,
    clearcoat: cfg.clearcoat,
    clearcoatRoughness: 0.18,
    envMapIntensity: 0.85,
  })

  // Carbon fiber weave material
  const carbonTex = makeCarbonFiberTexture()
  const carbonMat = new THREE.MeshPhysicalMaterial({
    map: carbonTex,
    color: '#15171b',
    roughness: 0.28,
    metalness: 0.35,
    clearcoat: 1.0,
    clearcoatRoughness: 0.08,
    envMapIntensity: 1.1,
  })

  // Custom wheels material
  const wheelCfg = WHEEL_CONFIGS[initialWheel]
  const wheelMat = new THREE.MeshStandardMaterial({
    color: wheelCfg.hex,
    metalness: wheelCfg.metalness,
    roughness: wheelCfg.roughness,
    envMapIntensity: 0.95,
  })

  // Custom brake calipers material
  const caliperCfg = CALIPER_CONFIGS[initialCaliper]
  const caliperMat = new THREE.MeshStandardMaterial({
    color: caliperCfg.hex,
    metalness: caliperCfg.metalness,
    roughness: caliperCfg.roughness,
    envMapIntensity: 0.9,
  })

  const glass = darkGlass()
  const junk: THREE.Object3D[] = []
  const bonnetMeshes: THREE.Mesh[] = []
  /** every mesh + the material it wears in the normal (non X-ray) state */
  const allMeshes: Array<{ mesh: THREE.Mesh; kind: 'shell' | 'keep' | 'cabin' | 'glass' }> = []

  model.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return
    obj.castShadow = true
    obj.receiveShadow = false
    {
      const firstMat = Array.isArray(obj.material) ? obj.material[0] : obj.material
      const n = firstMat?.name ?? ''
      if (CLUTTER.test(n) || inClutterZone(obj)) {
        obj.visible = false
        return
      }
      const kind: 'shell' | 'keep' | 'cabin' | 'glass' = GLASS.has(n)
        ? 'glass'
        : XRAY_KEEP.test(n)
        ? 'keep'
        : CABIN.test(n)
        ? 'cabin'
        : 'shell'
      allMeshes.push({ mesh: obj, kind })
    }

    // Identify interactive parts
    if (obj.name === 'Object_4' || obj.name === 'Object_5') {
      bonnetMeshes.push(obj)
    } else if (obj.name === 'Object_73' || obj.name === 'Object_80' || obj.name === 'Object_66') {
      obj.material = wheelMat
      return
    } else if (obj.name === 'Object_74') {
      obj.material = caliperMat
      return
    } else if (obj.name === 'Object_44') {
      // Carbon fiber roof
      obj.material = carbonMat
      return
    }

    const mats = Array.isArray(obj.material) ? [...obj.material] : [obj.material]
    let replaced = false
    for (let i = 0; i < mats.length; i++) {
      const name = mats[i]?.name ?? ''
      if (BODY_PAINT.has(name)) {
        const mat = basePaint.clone()
        mats[i] = mat
        paintMaterials.push(mat)
        replaced = true
      } else if (GLASS.has(name)) {
        mats[i] = glass
        replaced = true
      } else if (mats[i] && (mats[i] as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
        ;(mats[i] as THREE.MeshStandardMaterial).envMapIntensity = 0.7
      }
    }
    if (replaced) obj.material = Array.isArray(obj.material) ? mats : mats[0]

    // hide giant flat plates (Sketchfab showroom floors)
    const b = new THREE.Box3().setFromObject(obj)
    if (b.max.y - b.min.y < 0.12 && b.max.x - b.min.x > 3 && b.max.z - b.min.z > 3) junk.push(obj)
  })
  junk.forEach((m) => (m.visible = false))

  /* ── X-ray: body shell → translucent wire "blueprint" ─────────────── */
  const xrayWire = new THREE.MeshBasicMaterial({
    color: 0x7fd3ff,
    wireframe: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  })
  const xrayGhost = new THREE.MeshBasicMaterial({
    color: 0x1f6fa8,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    fog: false,
  })
  const keepEmissive = new THREE.Color(0xff7a2a)
  const keepMats = new Set<THREE.MeshStandardMaterial>()
  const originalEmissive = new Map<THREE.MeshStandardMaterial, { c: THREE.Color; i: number }>()
  for (const { mesh, kind } of allMeshes) {
    if (kind !== 'keep') continue
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const m of mats) {
      const std = m as THREE.MeshStandardMaterial
      if (!std.isMeshStandardMaterial) continue
      if (!keepMats.has(std)) {
        keepMats.add(std)
        originalEmissive.set(std, { c: std.emissive.clone(), i: std.emissiveIntensity })
      }
    }
  }
  const shellOriginal = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>()
  /** shell meshes get a second, wireframe copy drawn over the (fading) paint */
  const wireClones: THREE.Mesh[] = []
  for (const { mesh, kind } of allMeshes) {
    if (kind !== 'shell' && kind !== 'glass') continue
    shellOriginal.set(mesh, mesh.material)
    const clone = new THREE.Mesh(mesh.geometry, xrayWire)
    clone.visible = false
    clone.renderOrder = 5
    clone.castShadow = false
    clone.frustumCulled = mesh.frustumCulled
    mesh.add(clone) // inherits the exact transform
    wireClones.push(clone)
  }
  let xrayLevel = 0
  let cockpitActive = false
  const setXray = (amount: number) => {
    const a = Math.min(1, Math.max(0, amount))
    if (Math.abs(a - xrayLevel) < 0.002) return
    xrayLevel = a
    const on = a > 0.001
    xrayWire.opacity = 0.42 * a
    xrayGhost.opacity = 0.08 * a
    for (const clone of wireClones) clone.visible = on
    for (const { mesh, kind } of allMeshes) {
      if (kind === 'shell' || kind === 'glass') {
        if (cockpitActive) continue
        // paint fades out over the first 60 % of the scan, wire fades in
        const orig = shellOriginal.get(mesh)!
        if (a > 0.6) {
          mesh.material = xrayGhost
          mesh.castShadow = false
        } else {
          mesh.material = orig
          mesh.castShadow = true
          const mats = Array.isArray(orig) ? orig : [orig]
          for (const m of mats) {
            m.transparent = a > 0
            m.opacity = 1 - a / 0.6
            m.depthWrite = a === 0
            m.needsUpdate = false
          }
        }
      }
    }
    for (const std of keepMats) {
      const o = originalEmissive.get(std)!
      std.emissive.copy(o.c).lerp(keepEmissive, a)
      std.emissiveIntensity = o.i + a * 0.55
    }
  }

  /* ── Cockpit: hide the shell so the camera can sit inside ─────────── */
  const clusterMats = new Set<THREE.MeshStandardMaterial>()
  const clusterOriginal = new Map<THREE.MeshStandardMaterial, { c: THREE.Color; i: number }>()
  for (const { mesh } of allMeshes) {
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const m of mats) {
      const std = m as THREE.MeshStandardMaterial
      if (!std.isMeshStandardMaterial || !CLUSTER.test(std.name ?? '')) continue
      if (!clusterMats.has(std)) {
        clusterMats.add(std)
        clusterOriginal.set(std, { c: std.emissive.clone(), i: std.emissiveIntensity })
      }
    }
  }
  const M_TINT: Record<MMode, { color: number; intensity: number }> = {
    road: { color: 0x6fb4ff, intensity: 0.28 },
    m1: { color: 0xe01818, intensity: 0.6 },
    m2: { color: 0xff5a00, intensity: 0.7 },
  }
  const setCockpit = (active: boolean, mode: MMode) => {
    cockpitActive = active
    for (const { mesh, kind } of allMeshes) {
      if (kind === 'shell' || kind === 'glass') {
        // in the cockpit the roof/pillars/glass are culled from the inside
        // via FrontSide, so the interior stays framed by real bodywork
        mesh.visible = true
        if (kind === 'glass') mesh.visible = !active
      }
    }
    for (const std of clusterMats) {
      const o = clusterOriginal.get(std)!
      if (active) {
        std.emissive.setHex(M_TINT[mode].color)
        std.emissiveIntensity = M_TINT[mode].intensity
      } else {
        std.emissive.copy(o.c)
        std.emissiveIntensity = o.i
      }
    }
  }

  // Driver's eye — measured offline from the decoded GLB: steering wheel rim
  // centre (0.37, 0.77, −0.36), seat back at x≈−0.15. Eye sits behind the
  // wheel at head height on the driver side.
  const cockpitEye = new THREE.Vector3(-0.06, 1.0, -0.36)

  const setHoodOpen = (_open: boolean) => {}
  const setDoorOpen = (_open: boolean) => {}

  const setWheelFinish = (finish: WheelFinish) => {
    const wCfg = WHEEL_CONFIGS[finish]
    wheelMat.color.set(wCfg.hex)
    wheelMat.metalness = wCfg.metalness
    wheelMat.roughness = wCfg.roughness
    wheelMat.needsUpdate = true
  }

  const setCaliperColor = (color: CaliperColor) => {
    const cCfg = CALIPER_CONFIGS[color]
    caliperMat.color.set(cCfg.hex)
    caliperMat.metalness = cCfg.metalness
    caliperMat.roughness = cCfg.roughness
    caliperMat.needsUpdate = true
  }

  const setPaintColor = (p: PaintFinish) => {
    const pCfg = PAINT_CONFIGS[p]
    basePaint.color.set(pCfg.hex)
    basePaint.metalness = pCfg.metalness
    basePaint.roughness = pCfg.roughness
    basePaint.clearcoat = pCfg.clearcoat
    paintMaterials.forEach((m) => {
      m.color.set(pCfg.hex)
      m.metalness = pCfg.metalness
      m.roughness = pCfg.roughness
      m.clearcoat = pCfg.clearcoat
    })
    bonnetMeshes.forEach((mesh) => {
      mesh.material = basePaint
    })
  }

  return {
    car,
    paintMaterials,
    setHoodOpen,
    setDoorOpen,
    setWheelFinish,
    setCaliperColor,
    setPaintColor,
    setXray,
    setCockpit,
    cockpitEye,
  }
}

/**
 * Finds the four wheel-hub XZ positions from the model's own geometry.
 * Vertices that actually touch the ground (y < 6 % of the car height) are
 * almost exclusively tire contact patches; clustered by XZ quadrant their
 * mean IS the hub. This survives merged / misleadingly named meshes — this
 * M5 packs several tires into one "Meshestires" mesh and puts wheel covers
 * under a "door" material — which per-mesh box heuristics do not. Validated
 * offline against the decoded GLB: hubs land within 2 cm of the true axle
 * centers. Falls back to M5 CS proportions when a quadrant comes up empty.
 * Call with the rig STILL UNPARENTED so world space == rig-local space.
 */
function detectWheelHubs(root: THREE.Object3D, size: THREE.Vector3): Array<[number, number]> {
  root.updateMatrixWorld(true)
  const yMax = size.y * 0.06
  const quads = [0, 1, 2, 3].map(() => ({ x: 0, z: 0, n: 0 }))
  const v = new THREE.Vector3()
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh) || !obj.visible) return
    const attr = obj.geometry.getAttribute('position')
    if (!attr) return
    for (let i = 0; i < attr.count; i++) {
      v.fromBufferAttribute(attr, i)
      obj.localToWorld(v)
      if (v.y > yMax) continue
      const q = (v.x > 0 ? 1 : 0) + (v.z > 0 ? 2 : 0)
      const bucket = quads[q]
      bucket.x += v.x
      bucket.z += v.z
      bucket.n++
    }
  })
  const hubs = quads.map((b) => (b.n > 0 ? ([b.x / b.n, b.z / b.n] as [number, number]) : null))
  if (hubs.every((h) => h !== null)) return hubs as Array<[number, number]>
  // Fallback — normalized M5 CS proportions (axles ≈ ±0.30 L, track ≈ ±0.38 W)
  return [
    [-0.3 * size.x, 0.38 * size.z],
    [-0.3 * size.x, -0.38 * size.z],
    [0.3 * size.x, 0.38 * size.z],
    [0.3 * size.x, -0.38 * size.z],
  ]
}

/* ══════════════════════════════════════════════════════════════════════
 * Camera-rig math
 * ══════════════════════════════════════════════════════════════════════ */

type FlatKey = { px: number; py: number; pz: number; tx: number; ty: number; tz: number }

/** 0 → 1 "scan" amount over the X-ray dwell. The camera parks on the
 *  broadside at P.xrayIn; the wireframe reveal + spec counters run from
 *  there to P.xrayScanEnd and hold until the outro pull-back begins
 *  (fading back out over the first part of the outro). */
function xrayAmount(p: number): number {
  const inT = (p - P.xrayIn) / (P.xrayScanEnd - P.xrayIn)
  const outT = (p - P.outroStart) / 0.06
  const a = Math.min(1, Math.max(0, inT))
  const b = 1 - Math.min(1, Math.max(0, outT))
  return Math.min(a, b)
}

/** Flatten a keyframe; on portrait screens the pos→target offset is
 *  scaled by mobileF so the car never clips out of the narrow viewport. */
function flattenKey(k: CamKey, mobile: boolean): FlatKey {
  if (mobile && k.mobile) {
    const [px, py, pz] = k.mobile.pos
    const [tx, ty, tz] = k.mobile.target
    return { px, py, pz, tx, ty, tz }
  }
  let [px, py, pz] = k.pos
  const [tx, ty, tz] = k.target
  if (mobile) {
    px = tx + (px - tx) * k.mobileF
    py = ty + (py - ty) * k.mobileF
    pz = tz + (pz - tz) * k.mobileF * (k.mobileHeadOn ?? 1)
  }
  return { px, py, pz, tx, ty, tz }
}

/* ══════════════════════════════════════════════════════════════════════
 * Overlay Navigation & Stage Anchors
 * ══════════════════════════════════════════════════════════════════════ */

const NAV_ITEMS = [
  { id: 'overview', label: 'Overview' },
  { id: 'performance', label: 'Performance' },
  { id: 'design', label: 'Design' },
  { id: 'xray', label: 'X-Ray' },
  { id: 'specs', label: 'Specs' },
] as const

/* ── Scroll-progress map (must match buildTimeline below) ─────────────── */
const P = {
  frontIn: 0.24, // camera reaches the front pose
  rearStart: 0.34,
  rearIn: 0.56,
  xrayStart: 0.66,
  xrayIn: 0.78, // camera parked on the broadside — scan begins
  xrayScanEnd: 0.88, // wireframe fully revealed, counters at 100 %
  outroStart: 0.88,
  outroIn: 1.0,
} as const

type SectionId = (typeof NAV_ITEMS)[number]['id']

type StarDot = {
  top: string
  side: 'left' | 'right'
  offset: string
  size: number
  opacity: number
  glow?: string
}

const STAR_DOTS: StarDot[] = [
  { top: '14%', side: 'left', offset: '14%', size: 3, opacity: 0.5, glow: '0 0 6px 1px oklch(0.85 0.08 85 / 0.5)' },
  { top: '28%', side: 'right', offset: '18%', size: 2, opacity: 0.4, glow: '0 0 5px 1px oklch(0.85 0.08 85 / 0.4)' },
  { top: '49%', side: 'left', offset: '10%', size: 2, opacity: 0.35 },
  { top: '60%', side: 'right', offset: '12%', size: 3, opacity: 0.3, glow: '0 0 6px 1px oklch(0.85 0.08 85 / 0.35)' },
  { top: '21%', side: 'left', offset: '33%', size: 2, opacity: 0.3 },
  { top: '40%', side: 'right', offset: '33%', size: 2, opacity: 0.45 },
]

function starDotStyle(dot: StarDot): CSSProperties {
  return {
    top: dot.top,
    width: dot.size,
    height: dot.size,
    opacity: dot.opacity,
    boxShadow: dot.glow ?? 'none',
    ...(dot.side === 'left' ? { left: dot.offset } : { right: dot.offset }),
  }
}

/* ══════════════════════════════════════════════════════════════════════
 * Component
 * ══════════════════════════════════════════════════════════════════════ */

export default function ScrollExperience() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const heroLayerRef = useRef<HTMLDivElement>(null)
  const capFrontRef = useRef<HTMLDivElement>(null)
  const capRearRef = useRef<HTMLDivElement>(null)
  const xrayPanelRef = useRef<HTMLDivElement>(null)
  const xrayScanRef = useRef<HTMLDivElement>(null)
  const endCardRef = useRef<HTMLDivElement>(null)
  const xrayProgressRef = useRef(0)

  const [theme, setTheme] = useState<StudioTheme>('apex')
  const [highBeams, setHighBeams] = useState(true)
  const [paint, setPaint] = useState<PaintFinish>('brands-hatch-grey')
  const [wheelFinish, setWheelFinish] = useState<WheelFinish>('gold-bronze')
  const [caliperColor, setCaliperColor] = useState<CaliperColor>('red')
  const [hoodOpen, setHoodOpen] = useState(false)
  const [doorOpen, setDoorOpen] = useState(false)
  const [orbitMode, setOrbitMode] = useState(false)
  const [activeSection, setActiveSection] = useState<SectionId>('overview')
  const [scrollProgress, setScrollProgress] = useState(0)
  const [showText, setShowText] = useState(true)
  const [showBookingModal, setShowBookingModal] = useState(false)
  const [bookingConfirmed, setBookingConfirmed] = useState(false)
  const [sceneId, setSceneId] = useState<SceneId>(() => getInitialSceneId())
  const [sceneFacts, setSceneFacts] = useState<Array<{ label: string; value: string }>>([])
  const initialSceneRef = useRef<SceneId>(sceneId)
  const [cockpitMode, setCockpitMode] = useState(false)
  const [xrayValues, setXrayValues] = useState<number[]>(() => SPEC_STATS.map(() => 0))

  const scrollProgressRef = useRef(0)
  const lenisInstanceRef = useRef<Lenis | null>(null)
  const updateThemeRef = useRef<((t: StudioTheme, hb: boolean) => void) | null>(null)
  const updatePaintRef = useRef<((p: PaintFinish) => void) | null>(null)
  const updateWheelRef = useRef<((w: WheelFinish) => void) | null>(null)
  const updateCaliperRef = useRef<((c: CaliperColor) => void) | null>(null)
  const toggleHoodRef = useRef<((open: boolean) => void) | null>(null)
  const toggleDoorRef = useRef<((open: boolean) => void) | null>(null)
  const toggleOrbitRef = useRef<((active: boolean) => void) | null>(null)
  const setSceneRef = useRef<((id: SceneId) => void) | null>(null)
  const toggleCockpitRef = useRef<((active: boolean, mode: MMode) => void) | null>(null)
  const mouseRef = useRef({ x: 0, y: 0, targetX: 0, targetY: 0 })

  const scrollToSection = useCallback((section: SectionId) => {
    const track = trackRef.current
    if (!track) return
    const maxScroll = track.offsetHeight - window.innerHeight
    let target = 0
    if (section === 'overview') target = 0
    else if (section === 'performance') target = maxScroll * 0.27
    else if (section === 'design') target = maxScroll * 0.59
    else if (section === 'xray') target = maxScroll * 0.86
    else if (section === 'specs') target = maxScroll * 0.99

    if (lenisInstanceRef.current) {
      lenisInstanceRef.current.scrollTo(target, { duration: 1.2 })
    } else {
      window.scrollTo({ top: target, behavior: 'smooth' })
    }
  }, [])

  const handleThemeChange = useCallback((newTheme: StudioTheme) => {
    setTheme(newTheme)
    updateThemeRef.current?.(newTheme, highBeams)
  }, [highBeams])

  const toggleHighBeams = useCallback(() => {
    setHighBeams((prev) => {
      const next = !prev
      updateThemeRef.current?.(theme, next)
      return next
    })
  }, [theme])

  const handlePaintChange = useCallback((finish: PaintFinish) => {
    setPaint(finish)
    updatePaintRef.current?.(finish)
  }, [])

  const handleWheelChange = useCallback((finish: WheelFinish) => {
    setWheelFinish(finish)
    updateWheelRef.current?.(finish)
  }, [])

  const handleCaliperChange = useCallback((color: CaliperColor) => {
    setCaliperColor(color)
    updateCaliperRef.current?.(color)
  }, [])

  const handleToggleText = useCallback(() => {
    setShowText((previous) => !previous)
  }, [])

  const handleToggleHood = useCallback(() => {
    setHoodOpen((prev) => {
      const next = !prev
      toggleHoodRef.current?.(next)
      return next
    })
  }, [])

  const handleToggleDoor = useCallback(() => {
    setDoorOpen((prev) => {
      const next = !prev
      toggleDoorRef.current?.(next)
      return next
    })
  }, [])

  const handleOrbitToggle = useCallback(() => {
    setCockpitMode(false)
    toggleCockpitRef.current?.(false, 'road')
    setOrbitMode((prev) => {
      const next = !prev
      toggleOrbitRef.current?.(next)
      return next
    })
  }, [])

  const handleSceneChange = useCallback((id: SceneId) => {
    setSceneId(id)
    if (typeof window !== 'undefined') {
      try {
        sessionStorage.setItem('m5cs_active_scene', id)
      } catch {}
    }
    setSceneRef.current?.(id)
  }, [])

  const handleRandomScene = useCallback(() => {
    const next = getRandomSceneId(sceneId)
    handleSceneChange(next)
  }, [sceneId, handleSceneChange])

  const handleCockpitToggle = useCallback(() => {
    setCockpitMode((prev) => {
      const next = !prev
      if (next) {
        setOrbitMode(false)
        toggleOrbitRef.current?.(false)
      }
      toggleCockpitRef.current?.(next, 'road')
      return next
    })
  }, [])

  /* Spec counters — driven from the scrubbed X-ray progress at ~30 Hz so the
   * React re-render cost stays trivial while the numbers still feel live. */
  useEffect(() => {
    let raf = 0
    let lastShown = -1
    let lastTs = 0
    const loop = (ts: number) => {
      raf = requestAnimationFrame(loop)
      if (ts - lastTs < 33) return
      lastTs = ts
      const a = xrayProgressRef.current
      const atEnd = a >= 0.999 && lastShown < 0.999
      if (!atEnd && Math.abs(a - lastShown) < 0.004) return
      lastShown = a
      // each stat starts a little later than the previous one (stagger)
      setXrayValues(
        SPEC_STATS.map((stat, i) => {
          const start = i * 0.08
          const t = Math.min(1, Math.max(0, (a - start) / (1 - start)))
          if (t >= 0.9) return stat.value // snap early — never show 1,824 for 1,825
          const eased = 1 - Math.pow(1 - t, 3)
          return stat.value * eased
        }),
      )
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    const track = trackRef.current
    const heroLayer = heroLayerRef.current
    const capFront = capFrontRef.current
    const capRear = capRearRef.current
    const endCard = endCardRef.current
    const xrayPanel = xrayPanelRef.current
    const xrayScan = xrayScanRef.current
    if (
      !canvas ||
      !track ||
      !heroLayer ||
      !capFront ||
      !capRear ||
      !endCard ||
      !xrayPanel ||
      !xrayScan
    )
      return

    let disposed = false
    gsap.registerPlugin(ScrollTrigger)

    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    /* ── Renderer ──────────────────────────────────────────────────── */
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)) // perf cap
    renderer.setSize(window.innerWidth, window.innerHeight, false)
    renderer.shadowMap.enabled = true
    // three r186 removed PCFSoftShadowMap — PCFShadowMap is the supported
    // filtered shadow path (renders soft contacts with a 2K map)
    renderer.shadowMap.type = THREE.PCFShadowMap
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.0
    renderer.outputColorSpace = THREE.SRGBColorSpace

    /* ── Scene: procedural 3D showroom (vignette + fog, no images) ──── */
    const scene = new THREE.Scene()
    const backdropTex = makeStudioBackdropTexture()
    scene.background = backdropTex
    scene.fog = new THREE.FogExp2(0x050608, 0.018) // thin enough for the cyclorama to read, thick enough to hide the floor rim

    // Studio reflections via a self-contained PMREM environment (no HDR
    // download) — this is what puts the softbox highlights in the paint.
    const pmrem = new THREE.PMREMGenerator(renderer)
    const envScene = new RoomEnvironment()
    const envTex = pmrem.fromScene(envScene, 0.04).texture
    scene.environment = envTex
    ;(envScene as unknown as { dispose?: () => void }).dispose?.()

    /* ── Camera ────────────────────────────────────────────────────── */
    const camera = new THREE.PerspectiveCamera(FOV_DESKTOP, window.innerWidth / window.innerHeight, 0.1, 160)

    let updateDust: ((t: number) => void) | null = null

    /* ── Lights — three-point studio rig ───────────────────────────── */
    const key = new THREE.SpotLight(0xfff1dd, 380) // warm keylight — casts the contact shadow
    key.position.set(7, 9, 5)
    key.angle = 0.55
    key.penumbra = 0.55
    key.decay = 2
    key.castShadow = true
    key.shadow.mapSize.set(2048, 2048)
    key.shadow.radius = 4 // PCF penumbra softening
    key.shadow.bias = -0.0002
    key.shadow.normalBias = 0.02
    key.shadow.camera.near = 3
    key.shadow.camera.far = 30
    key.target.position.set(0, 0.5, 0)
    scene.add(key, key.target)

    const rim = new THREE.DirectionalLight(0xbfd0e8, 1.6) // cool rim separation
    rim.position.set(-8, 5, -6)
    scene.add(rim)

    const hemi = new THREE.HemisphereLight(0x39404e, 0x0b0c10, 0.42) // studio ambience
    scene.add(hemi)

    /* Everything that IS the studio (canopy, cyclorama, pylons, shaft, dust,
     * floor, pool) lives in this group so a location swap can hide it in one
     * call and bring it back untouched. */
    const studio = new THREE.Group()
    scene.add(studio)

    /* ── Suspended architectural luminaire canopy (Next-Level Overhead Studio) ──
     * A structural floating truss system with high-output emissive diffuser panels,
     * chamfered dark metallic bezels, M-aerodynamic angled winglet strips,
     * and high-tension steel suspension cables vanishing into the ceiling fog. */
    const canopyGroup = new THREE.Group()
    canopyGroup.position.set(0, 5.35, 0)
    studio.add(canopyGroup)

    const diffuserMat = new THREE.MeshBasicMaterial({ color: 0xffeedb, side: THREE.DoubleSide })
    const outerFrameMat = new THREE.MeshStandardMaterial({ color: 0x0c0e14, metalness: 0.9, roughness: 0.25 })

    // Central primary softbox diffuser
    const centerDiffuser = new THREE.Mesh(new THREE.PlaneGeometry(16, 2.2), diffuserMat)
    centerDiffuser.rotation.x = Math.PI / 2
    canopyGroup.add(centerDiffuser)

    // Structural frame border bars around the central softbox
    for (const zOffset of [-1.12, 1.12]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(16.3, 0.12, 0.1), outerFrameMat)
      bar.position.set(0, 0.04, zOffset)
      canopyGroup.add(bar)
    }
    for (const xOffset of [-8.15, 8.15]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 2.34), outerFrameMat)
      bar.position.set(xOffset, 0.04, 0)
      canopyGroup.add(bar)
    }

    // Angled M-aerodynamic flank light strips
    const wingMat = new THREE.MeshBasicMaterial({ color: 0xe8ecf4, side: THREE.DoubleSide })
    for (const zSide of [-3.6, 3.6]) {
      const wing = new THREE.Mesh(new THREE.PlaneGeometry(14, 0.65), wingMat)
      wing.position.set(0, -0.08, zSide)
      wing.rotation.x = Math.PI / 2 + (zSide > 0 ? -0.2 : 0.2)
      canopyGroup.add(wing)

      const wingFrame = new THREE.Mesh(new THREE.BoxGeometry(14.2, 0.08, 0.08), outerFrameMat)
      wingFrame.position.set(0, -0.04, zSide + (zSide > 0 ? 0.34 : -0.34))
      canopyGroup.add(wingFrame)
    }

    // High-tension steel suspension cables rising into the dark ceiling void
    const cableMat = new THREE.MeshBasicMaterial({ color: 0x42495b, transparent: true, opacity: 0.55 })
    for (const cx of [-7.6, 7.6]) {
      for (const cz of [-3.4, 3.4]) {
        const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 8, 8), cableMat)
        cable.position.set(cx, 4, cz)
        canopyGroup.add(cable)
      }
    }

    /* ── Cyclorama — 360° infinity cove with recessed LED columns & horizon glow ── */
    const cyclorama = new THREE.Mesh(
      new THREE.CylinderGeometry(46, 46, 24, 72, 1, true),
      new THREE.MeshBasicMaterial({ map: makeCycloramaTexture('apex'), side: THREE.BackSide }),
    )
    cyclorama.position.y = 12
    studio.add(cyclorama)

    /* ── Distant illuminated architectural column pylons ──────────────────────── */
    const pillarBodyMat = new THREE.MeshStandardMaterial({ color: 0x11131a, metalness: 0.7, roughness: 0.3 })
    const pillarLedMat = new THREE.MeshBasicMaterial({ color: 0xe8ecf8, transparent: true, opacity: 0.75 })

    const PILLAR_CONFIGS = [
      [-16, -12, 7.5],
      [-22, -4, 8.0],
      [-10, -18, 6.5],
      [18, -13, 5.0],
      [30, -7, 5.0],
      [-4, 20, 6.5],
    ] as const

    for (const [px, pz, ph] of PILLAR_CONFIGS) {
      const pGroup = new THREE.Group()
      pGroup.position.set(px, ph / 2, pz)

      const body = new THREE.Mesh(new THREE.BoxGeometry(0.18, ph, 0.18), pillarBodyMat)
      pGroup.add(body)

      // Recessed vertical LED strip running down its face
      const led = new THREE.Mesh(new THREE.PlaneGeometry(0.03, ph * 0.9), pillarLedMat)
      led.position.set(0, 0, 0.095)
      pGroup.add(led)

      studio.add(pGroup)

      // Reflected pylon below floor
      if (window.innerWidth >= 768) {
        const mirrorPGroup = pGroup.clone()
        mirrorPGroup.position.set(px, -ph / 2, pz)
        studio.add(mirrorPGroup)
      }
    }

    /* ── Volumetric light shaft + shimmering dust motes ─────────────── */
    let shaft: THREE.Mesh | null = null
    if (window.innerWidth >= 768) {
      shaft = new THREE.Mesh(
        new THREE.CylinderGeometry(0.55, 3.9, 5.3, 48, 1, true),
        new THREE.MeshBasicMaterial({
          map: makeLightShaftTexture('apex'),
          transparent: true,
          opacity: 0.11,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
          fog: false,
        }),
      )
      shaft.position.set(0, 2.68, 0)
      shaft.renderOrder = 2
      studio.add(shaft)

      const DUST_COUNT = 200
      const dustBase = new Float32Array(DUST_COUNT * 3)
      const dustSeed = new Float32Array(DUST_COUNT * 2)
      for (let i = 0; i < DUST_COUNT; i++) {
        const r = Math.sqrt(Math.random()) * 2.5
        const a = Math.random() * Math.PI * 2
        dustBase[i * 3] = Math.cos(a) * r
        dustBase[i * 3 + 1] = 0.25 + Math.random() * 3.8
        dustBase[i * 3 + 2] = Math.sin(a) * r
        dustSeed[i * 2] = 0.2 + Math.random() * 0.6
        dustSeed[i * 2 + 1] = Math.random() * Math.PI * 2
      }
      const dustGeo = new THREE.BufferGeometry()
      dustGeo.setAttribute('position', new THREE.BufferAttribute(dustBase.slice(), 3))
      const dust = new THREE.Points(
        dustGeo,
        new THREE.PointsMaterial({
          map: makeDustSpriteTexture(),
          size: 0.055,
          sizeAttenuation: true,
          color: 0xfff2dc,
          transparent: true,
          opacity: 0.36,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          fog: false,
        }),
      )
      dust.renderOrder = 3
      studio.add(dust)
      if (!prefersReduced) {
        updateDust = (t) => {
          const attr = dustGeo.attributes.position
          const arr = attr.array as Float32Array
          for (let i = 0; i < DUST_COUNT; i++) {
            arr[i * 3 + 1] = dustBase[i * 3 + 1] + Math.sin(t * dustSeed[i * 2] + dustSeed[i * 2 + 1]) * 0.4
          }
          attr.needsUpdate = true
          dust.rotation.y = t * 0.035
        }
      }
    }

    /* ── High-Tech Obsidian Floor with Precision Calibration Grid ──── */
    const floorTex = makeHighTechFloorTexture('apex')
    floorTex.wrapS = THREE.ClampToEdgeWrapping
    floorTex.wrapT = THREE.ClampToEdgeWrapping

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(90, 80),
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: floorTex,
        roughness: 0.35,
        metalness: 0.62,
        envMapIntensity: 0.5,
        transparent: true,
        opacity: 0.88,
      }),
    )
    floor.rotation.x = -Math.PI / 2
    floor.receiveShadow = true
    studio.add(floor)

    const poolTex = makeFloorPoolTexture('apex')
    const pool = new THREE.Mesh(
      new THREE.PlaneGeometry(13, 13),
      new THREE.MeshBasicMaterial({
        map: poolTex,
        transparent: true,
        opacity: 0.12,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    )
    pool.rotation.x = -Math.PI / 2
    pool.position.y = 0.01
    studio.add(pool)

    /* ── X-ray scan plane — a thin vertical light sheet that sweeps the
     *    length of the car while the shell dissolves into wireframe ──── */
    const scanTex = (() => {
      const c = document.createElement('canvas')
      c.width = 64
      c.height = 256
      const ctx = c.getContext('2d')!
      const g = ctx.createLinearGradient(0, 0, 64, 0)
      g.addColorStop(0, 'rgba(120,210,255,0)')
      g.addColorStop(0.5, 'rgba(180,235,255,1)')
      g.addColorStop(1, 'rgba(120,210,255,0)')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, 64, 256)
      const t = new THREE.CanvasTexture(c)
      t.colorSpace = THREE.SRGBColorSpace
      return t
    })()
    const scanPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(0.16, 1.9),
      new THREE.MeshBasicMaterial({
        map: scanTex,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: false,
      }),
    )
    scanPlane.rotation.y = Math.PI / 2 // faces ±X → sweeps along the car
    scanPlane.position.set(0, 0.85, 0)
    scanPlane.renderOrder = 6
    scanPlane.visible = false
    scene.add(scanPlane)
    // floor echo of the scan line
    const scanFloor = new THREE.Mesh(
      new THREE.PlaneGeometry(0.3, 3.2),
      new THREE.MeshBasicMaterial({
        map: scanTex,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      }),
    )
    scanFloor.rotation.x = -Math.PI / 2
    scanFloor.position.y = 0.02
    scanFloor.renderOrder = 6
    scanFloor.visible = false
    scene.add(scanFloor)

    /* ── Car root + contact shadows + dynamic automotive projections ─ */
    const carGroup = new THREE.Group()
    carGroup.rotation.y = BASE_YAW
    scene.add(carGroup)

    // Forward Laserlight floor beam projection
    const headlightTex = makeHeadlightProjectionTexture('apex')
    const headlightBeam = new THREE.Mesh(
      new THREE.PlaneGeometry(7.5, 4.4),
      new THREE.MeshBasicMaterial({
        map: headlightTex,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        opacity: 0.82,
      }),
    )
    headlightBeam.rotation.x = -Math.PI / 2
    headlightBeam.position.set(4.6, 0.014, 0)
    headlightBeam.renderOrder = 2
    carGroup.add(headlightBeam)

    // Rear diffuser crimson glow pool
    const taillightTex = makeTaillightProjectionTexture()
    const taillightBeam = new THREE.Mesh(
      new THREE.PlaneGeometry(6.2, 3.8),
      new THREE.MeshBasicMaterial({
        map: taillightTex,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        opacity: 0.72,
      }),
    )
    taillightBeam.rotation.x = -Math.PI / 2
    taillightBeam.position.set(-4.2, 0.014, 0)
    taillightBeam.renderOrder = 2
    carGroup.add(taillightBeam)

    // Body AO contact shadow
    const contactTex = makeContactShadowTexture()
    const contact = new THREE.Mesh(
      new THREE.PlaneGeometry(TARGET_LENGTH * 1.22, TARGET_LENGTH * 0.56),
      new THREE.MeshBasicMaterial({ map: contactTex, transparent: true, depthWrite: false, opacity: 0.52 }),
    )
    contact.rotation.x = -Math.PI / 2
    contact.position.y = 0.014
    contact.renderOrder = 1
    carGroup.add(contact)

    /* ── Real-Time Theme Transition Handler ────────────────────────── */
    let currentTheme: StudioTheme = 'apex'
    let currentHighBeams = true
    let activeLocation: LocationScene | null = null
    let studioBackdrop: THREE.Texture = backdropTex
    const applyTheme = (t: StudioTheme, hb: boolean) => {
      currentTheme = t
      currentHighBeams = hb
      studioBackdrop.dispose()
      const newBackdrop = makeStudioBackdropTexture(t)
      studioBackdrop = newBackdrop
      if (!activeLocation) scene.background = newBackdrop

      const curCyMap = (cyclorama.material as THREE.MeshBasicMaterial).map
      curCyMap?.dispose()
      ;(cyclorama.material as THREE.MeshBasicMaterial).map = makeCycloramaTexture(t)
      ;(cyclorama.material as THREE.MeshBasicMaterial).needsUpdate = true

      const curFloorMap = (floor.material as THREE.MeshStandardMaterial).map
      curFloorMap?.dispose()
      ;(floor.material as THREE.MeshStandardMaterial).map = makeHighTechFloorTexture(t)
      ;(floor.material as THREE.MeshStandardMaterial).needsUpdate = true

      const curPoolMap = (pool.material as THREE.MeshBasicMaterial).map
      curPoolMap?.dispose()
      ;(pool.material as THREE.MeshBasicMaterial).map = makeFloorPoolTexture(t)
      ;(pool.material as THREE.MeshBasicMaterial).needsUpdate = true

      if (t === 'm') {
        diffuserMat.color.setHex(0xd0e8ff)
        wingMat.color.setHex(0x009ada)
      } else if (t === 'night') {
        diffuserMat.color.setHex(0xc0ddff)
        wingMat.color.setHex(0x89cff0)
      } else {
        diffuserMat.color.setHex(0xffeedb)
        wingMat.color.setHex(0xffeedb)
      }
      if (!activeLocation) {
        if (t === 'm') {
          key.color.setHex(0xeaf5ff)
          rim.color.setHex(0x009ada)
        } else if (t === 'night') {
          key.color.setHex(0xd0e6ff)
          rim.color.setHex(0x2860a8)
        } else {
          key.color.setHex(0xfff1dd)
          rim.color.setHex(0xbfd0e8)
        }
      }

      headlightBeam.material.map?.dispose()
      headlightBeam.material.map = makeHeadlightProjectionTexture(t)
      headlightBeam.material.needsUpdate = true
      applyBeams()
    }
    updateThemeRef.current = applyTheme

    const applyBeams = () => {
      const scale = activeLocation ? activeLocation.lighting.beamScale : 1
      headlightBeam.material.opacity = (currentHighBeams ? 0.85 : 0.15) * scale
      taillightBeam.material.opacity = (currentHighBeams ? 0.75 : 0.15) * scale
    }

    /* ── Location switcher ─────────────────────────────────────────────
     * The car, its contact shadows and the shared 3-light rig stay; the
     * studio group is hidden and a procedural environment takes its place.
     * Light colours / intensities / fog / exposure are tweened so the swap
     * reads as a cut-with-crossfade rather than a hard pop. */
    let mirrorRigRef: THREE.Object3D | null = null
    const lightTweens: gsap.core.Tween[] = []
    const applyLighting = (L: LocationLighting, instant = false) => {
      for (const tw of lightTweens) tw.kill()
      lightTweens.length = 0
      const fog = scene.fog as THREE.FogExp2
      const kc = new THREE.Color(L.key.color)
      const rc = new THREE.Color(L.rim.color)
      const hs = new THREE.Color(L.hemi.sky)
      const hg = new THREE.Color(L.hemi.ground)
      const fc = new THREE.Color(L.fog.color)
      if (instant) {
        key.color.copy(kc)
        key.intensity = L.key.intensity
        key.position.set(L.key.position[0], L.key.position[1], L.key.position[2])
        rim.color.copy(rc)
        rim.intensity = L.rim.intensity
        rim.position.set(L.rim.position[0], L.rim.position[1], L.rim.position[2])
        hemi.color.copy(hs)
        hemi.groundColor.copy(hg)
        hemi.intensity = L.hemi.intensity
        fog.color.copy(fc)
        fog.density = L.fog.density
        renderer.toneMappingExposure = L.exposure
        scene.environmentIntensity = L.environmentIntensity
        if (L.shadow) {
          if (L.shadow.angle !== undefined) key.angle = L.shadow.angle
          if (L.shadow.penumbra !== undefined) key.penumbra = L.shadow.penumbra
          if (L.shadow.near !== undefined) key.shadow.camera.near = L.shadow.near
          if (L.shadow.far !== undefined) key.shadow.camera.far = L.shadow.far
          if (L.shadow.mapSize) key.shadow.mapSize.set(L.shadow.mapSize, L.shadow.mapSize)
          key.shadow.camera.updateProjectionMatrix()
        }
        return
      }
      if (L.shadow) {
        // outdoor locations need a wider, longer shadow frustum than the cove
        if (L.shadow.angle !== undefined) key.angle = L.shadow.angle
        if (L.shadow.penumbra !== undefined) key.penumbra = L.shadow.penumbra
        if (L.shadow.near !== undefined) key.shadow.camera.near = L.shadow.near
        if (L.shadow.far !== undefined) key.shadow.camera.far = L.shadow.far
        if (L.shadow.mapSize) key.shadow.mapSize.set(L.shadow.mapSize, L.shadow.mapSize)
        key.shadow.camera.updateProjectionMatrix()
      }
      const d = 0.9
      const ease = 'power2.inOut'
      lightTweens.push(
        gsap.to(key.color, { r: kc.r, g: kc.g, b: kc.b, duration: d, ease }),
        gsap.to(key, { intensity: L.key.intensity, duration: d, ease }),
        gsap.to(key.position, { x: L.key.position[0], y: L.key.position[1], z: L.key.position[2], duration: d, ease }),
        gsap.to(rim.color, { r: rc.r, g: rc.g, b: rc.b, duration: d, ease }),
        gsap.to(rim, { intensity: L.rim.intensity, duration: d, ease }),
        gsap.to(rim.position, { x: L.rim.position[0], y: L.rim.position[1], z: L.rim.position[2], duration: d, ease }),
        gsap.to(hemi.color, { r: hs.r, g: hs.g, b: hs.b, duration: d, ease }),
        gsap.to(hemi.groundColor, { r: hg.r, g: hg.g, b: hg.b, duration: d, ease }),
        gsap.to(hemi, { intensity: L.hemi.intensity, duration: d, ease }),
        gsap.to(fog.color, { r: fc.r, g: fc.g, b: fc.b, duration: d, ease }),
        gsap.to(fog, { density: L.fog.density, duration: d, ease }),
        gsap.to(renderer, { toneMappingExposure: L.exposure, duration: d, ease }),
        gsap.to(scene, { environmentIntensity: L.environmentIntensity, duration: d, ease }),
      )
    }
    /* Locations ship an equirectangular sky. Baking it into scene.environment
     * means paint, glass and water reflect the place the car is parked in
     * instead of the neutral studio probe — the cheapest "this is a real
     * location" trick in the whole project. */
    let locationEnv: THREE.WebGLRenderTarget | null = null
    const applyEnvironment = (next: LocationScene | null) => {
      if (locationEnv) {
        // the whole target goes, not just its texture — a bare texture dispose
        // leaves the render target behind on every location switch
        locationEnv.dispose()
        locationEnv = null
      }
      if (next?.environment) {
        try {
          locationEnv = pmrem.fromEquirectangular(next.environment as THREE.Texture)
          scene.environment = locationEnv.texture
        } catch {
          scene.environment = envTex
        }
      } else {
        scene.environment = envTex
      }
    }

    const setLocation = (id: SceneId, instant = false) => {
      if ((activeLocation?.id ?? 'studio') === id && !instant) return
      if (activeLocation) {
        scene.remove(activeLocation.group)
        activeLocation.dispose()
        activeLocation = null
      }
      const mobile = window.innerWidth < 768
      let next: LocationScene | null = null
      try {
        next = buildLocationScene(id, { mobile })
      } catch (err) {
        console.warn('[scroll-experience] location build failed, staying in the studio:', err)
        next = null
      }
      activeLocation = next
      studio.visible = !next
      if (next) {
        scene.add(next.group)
        scene.background = next.background
        applyEnvironment(next)
        applyLighting(next.lighting, instant)
        if (mirrorRigRef) mirrorRigRef.visible = next.lighting.floorReflection
      } else {
        scene.background = studioBackdrop
        applyEnvironment(null)
        applyLighting(STUDIO_LIGHTING, instant)
        if (mirrorRigRef) mirrorRigRef.visible = true
        applyTheme(currentTheme, currentHighBeams) // restores theme-tinted key/rim
      }
      setSceneFacts(next?.facts ?? [])
      applyBeams()
      // let the new environment settle in from black
      if (!instant) {
        gsap.fromTo(canvas, { opacity: 0.15 }, { opacity: 1, duration: 0.7, ease: 'power2.out' })
      }
    }
    setSceneRef.current = (id: SceneId) => setLocation(id, false)

    // Apply the initial random location if not the studio baseline
    const initialLocation = initialSceneRef.current
    if (initialLocation && initialLocation !== 'studio') {
      setLocation(initialLocation, true)
    }

    let carRig: CarRig | null = null

    const cockpitState = {
      active: false,
      mode: 'road' as MMode,
      /** 0 → 1 transition (outside → seated) */
      t: 0,
      yaw: 0.08, // look slightly right toward the centre console
      pitch: -0.08,
      targetYaw: 0.08,
      targetPitch: -0.08,
      isDragging: false,
      lastX: 0,
      lastY: 0,
      // world-space snapshot of where the camera was when we got in
      fromPos: new THREE.Vector3(),
      fromLook: new THREE.Vector3(),
      // through-the-window waypoint (world space)
      via: new THREE.Vector3(),
    }

    const applyPaint = (finish: PaintFinish) => {
      const cfg = PAINT_CONFIGS[finish]
      if (carRig) {
        for (const mat of carRig.paintMaterials) {
          mat.color.set(cfg.hex)
          mat.roughness = cfg.roughness
          mat.metalness = cfg.metalness
          mat.clearcoat = cfg.clearcoat
          mat.needsUpdate = true
        }
      }
    }
    updatePaintRef.current = applyPaint

    /* ── Model streaming — REAL progress % into the loading overlay ──
     * GLTFLoader.load()'s onProgress is unreliable (Content-Length is lost
     * on some CDNs), so we fetch the GLB ourselves, count bytes against the
     * header (falling back to an asymptotic trickle), hand the buffer to
     * GLTFLoader.parse with the MeshoptDecoder, then fade the overlay.
     * The car settle-in doubles as the reveal beat after the fade. */
    ;(async () => {
      try {
        let arrayBuffer: ArrayBuffer | null = null

        // Try CacheStorage first for instant loading
        if (typeof window !== 'undefined' && 'caches' in window) {
          try {
            const cache = await caches.open('bmw-m5-cs-cache-v1')
            const match = await cache.match(MODEL_URL)
            if (match) {
              arrayBuffer = await match.arrayBuffer()
            } else {
              const netRes = await fetch(MODEL_URL)
              if (netRes.ok) {
                cache.put(MODEL_URL, netRes.clone()).catch(() => {})
                arrayBuffer = await netRes.arrayBuffer()
              }
            }
          } catch {
            // Fallback gracefully to network fetch
          }
        }

        if (!arrayBuffer) {
          const res = await fetch(MODEL_URL)
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          arrayBuffer = await res.arrayBuffer()
        }

        if (disposed) return

        const loader = new GLTFLoader()
        loader.setMeshoptDecoder(MeshoptDecoder)
        const gltf = await loader.parseAsync(arrayBuffer, '')
        if (disposed) return

        carRig = buildCarRig(gltf.scene, paint, wheelFinish, caliperColor)

        updatePaintRef.current = (newPaint: PaintFinish) => {
          carRig?.setPaintColor(newPaint)
        }
        updateWheelRef.current = (newWheel: WheelFinish) => {
          carRig?.setWheelFinish(newWheel)
        }
        updateCaliperRef.current = (newCaliper: CaliperColor) => {
          carRig?.setCaliperColor(newCaliper)
        }
        toggleHoodRef.current = (open: boolean) => {
          carRig?.setHoodOpen(open)
        }
        toggleDoorRef.current = (open: boolean) => {
          carRig?.setDoorOpen(open)
        }

        // Measure + detect BEFORE parenting: Box3.setFromObject() works in
        // WORLD space, so measuring inside the yawed carGroup bakes BASE_YAW
        // into the footprint — that inflates width by ~35 % and shoved the
        // old patches ~0.3 m outboard of the tires. Rig unparented ⇒ world
        // space == rig-local space.
        const footprint = new THREE.Box3().setFromObject(carRig.car)
        const carSize = footprint.getSize(new THREE.Vector3())
        const hubs = detectWheelHubs(carRig.car, carSize)

        carRig.car.position.y = -0.12
        carGroup.add(carRig.car)

        // Hug the body-AO ellipse to the measured footprint (was a fixed
        // TARGET_LENGTH-sized plane that spilled half a metre past the
        // bumpers and read as a dark halo floating around the car).
        contact.geometry.dispose()
        contact.geometry = new THREE.PlaneGeometry(carSize.x * 1.02, carSize.z * 1.18)

        // Per-wheel contact patches anchored at the detected hubs — each
        // blob now sits centered under its tire instead of guessing from
        // footprint fractions (the source mesh merges/misnames wheels).
        const wheelTex = makeWheelShadowTexture()
        const wheelShadowMat = new THREE.MeshBasicMaterial({
          map: wheelTex,
          transparent: true,
          depthWrite: false,
          opacity: 0.78,
        })
        for (const [wx, wz] of hubs) {
          const patch = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.5), wheelShadowMat)
          patch.rotation.x = -Math.PI / 2
          patch.position.set(wx, 0.011, wz)
          patch.renderOrder = 1
          carGroup.add(patch)
        }

        // Mirrored double just below y = 0 — shows through the semi-
        // transparent floor as a soft showroom reflection (desktop only;
        // the doubled vertex load isn't worth it on phones).
        if (FLOOR_REFLECTION && window.innerWidth >= 768) {
          const mirrorRig = buildCarRig(gltf.scene, paint)
          mirrorRig.car.scale.y = -1
          mirrorRig.car.traverse((obj) => {
            if (!(obj instanceof THREE.Mesh)) return
            obj.castShadow = false
            obj.receiveShadow = false
            const mats = Array.isArray(obj.material)
              ? obj.material.map((m) => m.clone())
              : [obj.material.clone()]
            for (const m of mats) {
              const std = m as THREE.MeshStandardMaterial
              std.side = THREE.DoubleSide // negative scale flips winding
              std.envMapIntensity = Math.min(0.5, (std.envMapIntensity ?? 1) * 0.6)
            }
            obj.material = Array.isArray(obj.material) ? mats : mats[0]
          })
          carGroup.add(mirrorRig.car)
          mirrorRigRef = mirrorRig.car
          mirrorRig.car.visible = (activeLocation as LocationScene | null)?.lighting.floorReflection ?? true
        }

        gsap.to(carRig!.car.position, { y: 0, duration: 0.8, ease: 'power2.out' })
        // the user may have scrolled into the X-ray band before the model landed
        carRig!.setXray(xrayProgressRef.current)
        if (cockpitState.active) carRig!.setCockpit(true, cockpitState.mode)
      } catch (err) {
        console.warn('[scroll-experience] car model failed to load:', err)
      }
    })()

    /* ── Camera rig state — animated by GSAP or Orbit Drag ─────────── */
    const cam: FlatKey = { px: 0, py: 0, pz: 0, tx: 0, ty: 0, tz: 0 }
    let frameDt = 1 / 60 // seconds since last tick (set in tick)

    let isOrbitActive = false

    const orbitState = {
      theta: Math.PI * 0.28,
      phi: Math.PI * 0.38,
      radius: 7.2,
      targetRadius: 7.2,
      targetTheta: Math.PI * 0.28,
      targetPhi: Math.PI * 0.38,
      isDragging: false,
      lastX: 0,
      lastY: 0,
    }

    /* ── Cockpit ("Get in") — camera flies through the driver's window to
     *    the eye point, then drag looks around from a fixed head position ── */
    let cockpitTween: gsap.core.Tween | null = null
    const calloutEls = new Map<string, HTMLElement>()
    for (const c of COCKPIT_CALLOUTS) {
      const el = document.getElementById(`cockpit-callout-${c.id}`)
      if (el) calloutEls.set(c.id, el)
    }
    let calloutsShown = false
    const cockpitEyeWorld = new THREE.Vector3()
    const cockpitLookWorld = new THREE.Vector3()
    const tmpV = new THREE.Vector3()
    const tmpA = new THREE.Vector3()
    const tmpB = new THREE.Vector3()
    const curveOut = new THREE.Vector3()

    toggleCockpitRef.current = (active: boolean, mode: MMode) => {
      cockpitState.mode = mode
      if (active === cockpitState.active) {
        if (active) carRig?.setCockpit(true, mode)
        return
      }
      cockpitState.active = active
      cockpitTween?.kill()
      if (active) {
        cockpitState.fromPos.copy(camera.position)
        camera.getWorldDirection(tmpV)
        cockpitState.fromLook.copy(camera.position).addScaledVector(tmpV, 4)
        // driver's door waypoint: 1.6 m out from the B-pillar on the driver side
        cockpitState.via.set(0.15, 1.15, -2.3).applyAxisAngle(new THREE.Vector3(0, 1, 0), BASE_YAW)
        cockpitState.targetYaw = 0.08
        cockpitState.targetPitch = -0.08
        cockpitState.yaw = 0.55 // start looking toward the wheel as we slide in
        cockpitState.pitch = -0.2
        carRig?.setCockpit(true, mode)
        camera.near = 0.03
        camera.updateProjectionMatrix()
        cockpitTween = gsap.to(cockpitState, { t: 1, duration: 1.7, ease: 'power3.inOut' })
      } else {
        cockpitTween = gsap.to(cockpitState, {
          t: 0,
          duration: 1.2,
          ease: 'power3.inOut',
          onComplete: () => {
            carRig?.setCockpit(false, mode)
            camera.near = 0.1
            camera.updateProjectionMatrix()
          },
        })
      }
    }

    toggleOrbitRef.current = (active: boolean) => {
      isOrbitActive = active
      if (active) {
        const dx = camera.position.x
        const dy = camera.position.y - 0.6
        const dz = camera.position.z
        orbitState.radius = Math.max(4.0, Math.min(12.0, Math.sqrt(dx * dx + dy * dy + dz * dz)))
        orbitState.targetRadius = orbitState.radius
        orbitState.theta = Math.atan2(dx, dz)
        orbitState.targetTheta = orbitState.theta
        orbitState.phi = Math.acos(Math.max(-0.95, Math.min(0.95, dy / orbitState.radius)))
        orbitState.targetPhi = orbitState.phi
      }
    }

    const onPointerDown = (e: PointerEvent) => {
      if (cockpitState.active) {
        cockpitState.isDragging = true
        cockpitState.lastX = e.clientX
        cockpitState.lastY = e.clientY
        return
      }
      if (!isOrbitActive) return
      orbitState.isDragging = true
      orbitState.lastX = e.clientX
      orbitState.lastY = e.clientY
    }

    const onPointerMove = (e: PointerEvent) => {
      if (cockpitState.active && cockpitState.isDragging) {
        const dx = e.clientX - cockpitState.lastX
        const dy = e.clientY - cockpitState.lastY
        // drag right → look right (natural "turn your head" mapping)
        cockpitState.targetYaw = Math.max(-1.2, Math.min(1.35, cockpitState.targetYaw + dx * 0.0042))
        cockpitState.targetPitch = Math.max(-0.7, Math.min(0.45, cockpitState.targetPitch - dy * 0.0036))
        cockpitState.lastX = e.clientX
        cockpitState.lastY = e.clientY
        return
      }
      if (isOrbitActive && orbitState.isDragging) {
        const dx = e.clientX - orbitState.lastX
        const dy = e.clientY - orbitState.lastY
        orbitState.targetTheta -= dx * 0.007
        orbitState.targetPhi = Math.max(0.12, Math.min(Math.PI / 2 - 0.04, orbitState.targetPhi - dy * 0.006))
        orbitState.lastX = e.clientX
        orbitState.lastY = e.clientY
      }
    }

    const onPointerUp = () => {
      orbitState.isDragging = false
      cockpitState.isDragging = false
    }

    const onWheel = (e: WheelEvent) => {
      if (!isOrbitActive) return
      orbitState.targetRadius = Math.max(3.8, Math.min(13.5, orbitState.targetRadius + e.deltaY * 0.006))
    }

    canvas.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    canvas.addEventListener('wheel', onWheel, { passive: true })

    const applyCamera = () => {
      if (cockpitState.active || cockpitState.t > 0.0005) {
        // eye + look in world space (car-local → yawed carGroup)
        const eye = carRig?.cockpitEye ?? tmpA.set(-0.18, 1.02, -0.36)
        cockpitEyeWorld.copy(eye).applyAxisAngle(tmpB.set(0, 1, 0), BASE_YAW)
        const k = 1 - Math.exp(-frameDt * 7) // ≈ 0.11 per frame at 60 fps, fps-independent
        cockpitState.yaw += (cockpitState.targetYaw - cockpitState.yaw) * k
        cockpitState.pitch += (cockpitState.targetPitch - cockpitState.pitch) * k
        // forward = +X in car space; yaw rotates toward −Z (right) for positive
        const cy = Math.cos(cockpitState.pitch)
        tmpV.set(Math.cos(cockpitState.yaw) * cy, Math.sin(cockpitState.pitch), -Math.sin(cockpitState.yaw) * cy)
        tmpV.applyAxisAngle(tmpB.set(0, 1, 0), BASE_YAW)
        cockpitLookWorld.copy(cockpitEyeWorld).addScaledVector(tmpV, 3)

        const t = cockpitState.t
        // quadratic bezier from the outside pose, through the driver's
        // window, into the seat — keeps the camera from cutting through the roof
        const u = 1 - t
        curveOut
          .copy(cockpitState.fromPos)
          .multiplyScalar(u * u)
          .addScaledVector(cockpitState.via, 2 * u * t)
          .addScaledVector(cockpitEyeWorld, t * t)
        tmpA.copy(cockpitState.fromLook).lerp(cockpitLookWorld, t * t * (3 - 2 * t))
        camera.position.copy(curveOut)
        camera.lookAt(tmpA)
        // FOV widens a touch inside so the dash + door card both fit
        const baseFov = window.innerWidth < 768 ? FOV_MOBILE : FOV_DESKTOP
        const fov = baseFov + (72 - baseFov) * t
        if (Math.abs(camera.fov - fov) > 0.05) {
          camera.fov = fov
          camera.updateProjectionMatrix()
        }
        return
      }
      if (isOrbitActive) {
        orbitState.theta += (orbitState.targetTheta - orbitState.theta) * 0.08
        orbitState.phi += (orbitState.targetPhi - orbitState.phi) * 0.08
        orbitState.radius += (orbitState.targetRadius - orbitState.radius) * 0.08

        const px = orbitState.radius * Math.sin(orbitState.phi) * Math.sin(orbitState.theta)
        const py = 0.6 + orbitState.radius * Math.cos(orbitState.phi)
        const pz = orbitState.radius * Math.sin(orbitState.phi) * Math.cos(orbitState.theta)

        camera.position.set(px, py, pz)
        camera.lookAt(0, 0.6, 0)
      } else {
        const m = mouseRef.current
        m.x += (m.targetX - m.x) * 0.05
        m.y += (m.targetY - m.y) * 0.05

        const pOffsetX = m.x * 0.28
        const pOffsetY = -m.y * 0.16
        const pOffsetZ = m.x * 0.18

        camera.position.set(cam.px + pOffsetX, cam.py + pOffsetY, cam.pz + pOffsetZ)
        camera.lookAt(cam.tx + pOffsetX * 0.25, cam.ty + pOffsetY * 0.15, cam.tz)
      }
    }

    const onMouseMove = (e: MouseEvent) => {
      mouseRef.current.targetX = (e.clientX / window.innerWidth - 0.5) * 2
      mouseRef.current.targetY = (e.clientY / window.innerHeight - 0.5) * 2
    }
    window.addEventListener('mousemove', onMouseMove)

    /* ── GSAP ScrollTrigger choreography ─────────────────────────────
     * One master timeline, scrubbed by scroll. Positions are expressed in
     * normalized progress units (the whole timeline lasts 1.0).        */
    const buildTimeline = (mobile: boolean) => {
      const K = {
        hero: flattenKey(KEYS.hero, mobile),
        front: flattenKey(KEYS.front, mobile),
        rear: flattenKey(KEYS.rear, mobile),
        xray: flattenKey(KEYS.xray, mobile),
        outro: flattenKey(KEYS.outro, mobile),
      }
      // hard-reset the rig to the hero pose so scrubbing always starts
      // from a known state (and fully rewinds when scrolling back up)
      Object.assign(cam, K.hero)
      applyCamera()

      const tl = gsap.timeline({
        defaults: { ease: 'power2.inOut' },
        scrollTrigger: {
          trigger: track,
          start: 'top top',
          end: 'bottom bottom',
          scrub: prefersReduced ? true : 1.2, // momentum catch-up
          onUpdate: (self) => {
            const p = self.progress
            setScrollProgress(p)
            scrollProgressRef.current = p
            if (p < 0.17) {
              setActiveSection('overview')
            } else if (p < 0.45) {
              setActiveSection('performance')
            } else if (p < 0.7) {
              setActiveSection('design')
            } else if (p < 0.92) {
              setActiveSection('xray')
            } else {
              setActiveSection('specs')
            }
            xrayProgressRef.current = xrayAmount(p)
          },
        },
      })

      /* Act I — HERO → FRONT (0 → 0.24) */
      tl.to(cam, { ...K.front, duration: P.frontIn }, 0)
      tl.to(heroLayer, { autoAlpha: 0, y: -36, duration: 0.1, ease: 'power1.in' }, 0.02)
      tl.fromTo(capFront, { autoAlpha: 0, y: 32, scale: 0.98 }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.07, ease: 'power2.out' }, 0.12)
      tl.to(capFront, { autoAlpha: 0, y: -24, scale: 0.98, duration: 0.06, ease: 'power1.in' }, 0.31)

      /* dwell on the front bumper (0.24 → 0.34) — no camera tweens */

      /* Act II — FRONT → REAR (0.34 → 0.56) */
      tl.to(cam, { ...K.rear, duration: P.rearIn - P.rearStart }, P.rearStart)
      tl.fromTo(capRear, { autoAlpha: 0, y: 32, scale: 0.98 }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.07, ease: 'power2.out' }, 0.44)
      tl.to(capRear, { autoAlpha: 0, y: -24, scale: 0.98, duration: 0.06, ease: 'power1.in' }, 0.62)

      /* dwell on the rear (0.56 → 0.66) */

      /* Act III — REAR → X-RAY (0.66 → 0.78): rise to the broadside, then
       * the scan runs 0.78 → 0.88 (driven per-frame from xrayAmount so the
       * three.js material swap and the DOM counters share one clock) */
      tl.to(cam, { ...K.xray, duration: P.xrayIn - P.xrayStart }, P.xrayStart)
      tl.fromTo(
        xrayPanel,
        { autoAlpha: 0, x: 40 },
        { autoAlpha: 1, x: 0, duration: 0.05, ease: 'power2.out' },
        P.xrayIn - 0.01,
      )
      tl.to(xrayPanel, { autoAlpha: 0, x: 24, duration: 0.05, ease: 'power1.in' }, P.outroStart + 0.02)

      /* Act IV — X-RAY → OUTRO (0.88 → 1.00) + closing card */
      tl.to(cam, { ...K.outro, duration: P.outroIn - P.outroStart }, P.outroStart)
      tl.fromTo(endCard, { autoAlpha: 0, y: 28, scale: 0.98 }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.08, ease: 'power2.out' }, 0.92)

      return tl
    }

    /* Breakpoint-aware setup: FOV + keyframe distances change between
     * desktop (16:9) and portrait mobile. gsap.matchMedia rebuilds the
     * timeline automatically when crossing 768px and cleans up on
     * unmount. Resizes within a breakpoint only need ScrollTrigger
     *.refresh() (handled in onResize below). */
    const mm = gsap.matchMedia()
    mm.add(
      {
        isDesktop: '(min-width: 768px)',
        isMobile: '(max-width: 767px)',
      },
      (ctx) => {
        const mobile = ctx.conditions?.isMobile === true
        camera.fov = mobile ? FOV_MOBILE : FOV_DESKTOP
        camera.updateProjectionMatrix()
        buildTimeline(mobile)
      },
    )

    /* ── Lenis momentum scrolling + a single GSAP ticker for everything ── */
    let lenis: Lenis | null = null
    if (!prefersReduced) {
      lenis = new Lenis({ duration: 1.15, smoothWheel: true })
      lenis.on('scroll', ScrollTrigger.update)
      lenisInstanceRef.current = lenis
    }

    const tick = (time: number, deltaMs: number) => {
      frameDt = Math.min(0.1, Math.max(0.001, deltaMs / 1000))
      lenis?.raf(time * 1000)
      applyCamera()
      updateDust?.(time)
      activeLocation?.update?.({
        time,
        dt: frameDt,
        camera,
        scroll: scrollProgressRef.current,
      })

      // X-ray: one clock for the wireframe dissolve, the scan sheet and the
      // DOM counters (which read the same ref on their own RAF).
      const xa = cockpitState.active ? 0 : xrayProgressRef.current
      carRig?.setXray(xa)
      const scanOn = xa > 0.001 && xa < 0.999
      scanPlane.visible = scanOn
      scanFloor.visible = scanOn
      if (scanOn) {
        // nose → tail sweep over the reveal, with a soft fade at both ends
        const sx = 2.5 - xa * 5.0
        const fade = Math.min(1, xa * 8, (1 - xa) * 8)
        scanPlane.position.x = sx
        scanFloor.position.x = sx
        ;(scanPlane.material as THREE.MeshBasicMaterial).opacity = 0.85 * fade
        ;(scanFloor.material as THREE.MeshBasicMaterial).opacity = 0.35 * fade
        xrayScan.style.setProperty('--scan', `${(xa * 100).toFixed(1)}%`)
      }

      // Cockpit call-outs: project car-local anchors to CSS pixels. Only
      // the ones in front of the camera and inside the frame are shown.
      if (cockpitState.t > 0.5) {
        const w = window.innerWidth
        const h = window.innerHeight
        for (const c of COCKPIT_CALLOUTS) {
          const el = calloutEls.get(c.id)
          if (!el) continue
          tmpV.set(c.localPos[0], c.localPos[1], c.localPos[2]).applyAxisAngle(tmpB.set(0, 1, 0), BASE_YAW)
          tmpV.project(camera)
          const inFront = tmpV.z < 1
          const x = (tmpV.x * 0.5 + 0.5) * w
          const y = (-tmpV.y * 0.5 + 0.5) * h
          const inside = inFront && x > 24 && x < w - 220 && y > 120 && y < h - 150
          const fade = Math.max(0, Math.min(1, (cockpitState.t - 0.7) / 0.3))
          el.style.opacity = inside ? String(fade) : '0'
          el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`
        }
      } else if (calloutsShown) {
        for (const el of calloutEls.values()) el.style.opacity = '0'
      }
      calloutsShown = cockpitState.t > 0.5

      renderer.render(scene, camera)
    }
    gsap.ticker.add(tick)
    gsap.ticker.lagSmoothing(0)

    /* ── Resize: reproject the camera, resize the renderer, refresh
     *    ScrollTrigger (debounced so mobile address-bar resize storms
     *    don't thrash the layout measurements) ──────────────────────── */
    let refreshTimer = 0
    const onResize = () => {
      const w = window.innerWidth
      const h = window.innerHeight
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h, false)
      window.clearTimeout(refreshTimer)
      refreshTimer = window.setTimeout(() => ScrollTrigger.refresh(), 150)
    }
    window.addEventListener('resize', onResize)

    /* ── Teardown — no memory leaks ────────────────────────────────── */
    return () => {
      disposed = true
      lenisInstanceRef.current = null
      canvas.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('wheel', onWheel)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('mousemove', onMouseMove)
      window.clearTimeout(refreshTimer)
      mm.revert() // kills the ScrollTriggers/tweens created per breakpoint
      ScrollTrigger.getAll().forEach((st) => st.kill()) // safety net
      gsap.ticker.remove(tick)
      lenis?.destroy()
      scene.traverse((obj) => {
        const o = obj as THREE.Mesh
        if (o.geometry) o.geometry.dispose()
        const m = o.material as THREE.Material | THREE.Material[] | undefined
        const disposeMat = (mat: THREE.Material) => {
          const withMap = mat as THREE.Material & { map?: THREE.Texture | null }
          withMap.map?.dispose()
          mat.dispose()
        }
        if (Array.isArray(m)) m.forEach(disposeMat)
        else if (m) disposeMat(m)
      })
      for (const tw of lightTweens) tw.kill()
      cockpitTween?.kill()
      if (activeLocation) {
        scene.remove(activeLocation.group)
        activeLocation.dispose()
        activeLocation = null
      }
      if (locationEnv) {
        locationEnv.dispose()
        locationEnv = null
      }
      scanTex.dispose()
      studioBackdrop.dispose()
      poolTex.dispose()
      envTex.dispose()
      pmrem.dispose()
      renderer.forceContextLoss()
      renderer.dispose()
    }
  }, [])

  /* ═══════════════════ Overlay markup (fixed stage) ═══════════════════ */

  return (
    <main
      className="relative w-full bg-[#050608] text-[#f2efe7]"
      data-immersive={orbitMode || cockpitMode ? 'true' : undefined}
      data-show-text={showText ? 'true' : 'false'}
    >
      {/*
        Invisible scroll track — its height (560vh) is the scroll distance
        ScrollTrigger scrubs the camera timeline through. Fully reversible.
      */}
      <div ref={trackRef} aria-hidden="true" className="h-[560vh]" />

      {/* Fixed 3D stage */}
      <canvas
        ref={canvasRef}
        role="img"
        aria-label="3D BMW M5 CS studio inspection — scroll to explore the car"
        className="fixed inset-0 z-0 block h-full w-full"
      />

      {/* Fixed UI overlay */}
      <div className="pointer-events-none fixed inset-0 z-10">
        {/* ── Navbar (100% Transparent Header with Official BMW Logo) ── */}
        <header className="pointer-events-auto fixed top-0 inset-x-0 z-30 flex items-center justify-between bg-transparent px-[clamp(20px,5vw,64px)] py-4 transition-all">
          {/* Brand logo */}
          <button
            type="button"
            onClick={() => scrollToSection('overview')}
            aria-label="BMW M5 CS — return to overview"
            className="group flex items-center gap-3 text-left transition-transform active:scale-95 cursor-pointer"
          >
            <div className="relative flex items-center gap-3">
              {/* Authentic BMW Roundel Logo */}
              <img
                src="/bmw-logo.svg"
                alt="BMW Logo"
                width={38}
                height={38}
                className="h-[38px] w-[38px] object-contain select-none filter drop-shadow-[0_2px_10px_rgba(0,0,0,0.7)]"
              />

              {/* Brand wordmark */}
              <div className="flex items-center [text-shadow:0_2px_10px_rgba(0,0,0,0.8)]">
                <span className="text-[17px] font-black italic tracking-wider text-white">M5 CS</span>
              </div>
            </div>
          </button>

          {/* Nav chapter pills */}
          <nav aria-label="Experience Navigation" className="hidden md:flex items-center gap-1 rounded-full border border-white/15 bg-black/30 p-1 shadow-2xl backdrop-blur-md">
            {NAV_ITEMS.map((item) => {
              const isActive = activeSection === item.id
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => scrollToSection(item.id)}
                  className={`relative rounded-full px-4 py-1.5 text-[12px] font-medium tracking-[0.03em] transition-all cursor-pointer ${
                    isActive
                      ? 'bg-white text-black font-semibold shadow-[0_2px_12px_rgba(255,255,255,0.25)]'
                      : 'text-white/75 hover:text-white hover:bg-white/10'
                  }`}
                >
                  {item.label}
                </button>
              )
            })}
          </nav>

          {/* Right Action: Book a Drive CTA */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setShowBookingModal(true)}
              className="group relative flex items-center gap-2 overflow-hidden rounded-full border border-white/20 bg-black/30 hover:bg-black/45 px-5 py-2 text-[12px] font-medium tracking-wide text-white shadow-2xl backdrop-blur-md transition-all active:scale-95 cursor-pointer"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-[#E4002B] animate-pulse" />
              <span>Book a Drive</span>
            </button>
          </div>
        </header>

        {/* ── Hero layer — fades out as the camera leaves the hero state ── */}
        <div
          ref={heroLayerRef}
          data-scroll-copy=""
          className={`absolute inset-0 flex flex-col transition-opacity duration-300 ${
            orbitMode || cockpitMode ? 'opacity-0 pointer-events-none' : ''
          }`}
        >
          {STAR_DOTS.map((dot) => (
            <span
              key={`${dot.top}-${dot.side}-${dot.offset}`}
              aria-hidden="true"
              className="pointer-events-none absolute rounded-full bg-[#e8ddc4]"
              style={starDotStyle(dot)}
            />
          ))}

          <section className="mt-auto flex flex-col items-center px-[clamp(20px,8vw,120px)] pb-[clamp(56px,9vh,90px)] text-center">
            <div aria-hidden="true" className="mb-[clamp(20px,3vh,32px)] flex items-center gap-4">
              <span className="h-px w-12 bg-[linear-gradient(90deg,transparent,#FFB733)]" />
              <span className="text-[18px] leading-none text-[#FFB733]">✦</span>
              <span className="h-px w-12 bg-[linear-gradient(90deg,#FFB733,transparent)]" />
            </div>

            <h1 className="m-0 mb-5 whitespace-nowrap text-[clamp(22px,5.5vw,44px)] font-semibold leading-[1.12] tracking-[-0.02em] text-[#f7f4ec]">
              Engineered for <span className="text-white">the Apex</span>
            </h1>

            <p className="m-0 mb-9 text-[15px] font-normal leading-[1.7] text-white/75">
              The most powerful BMW 5 Series of all time — a 627 hp twin-turbo V8{' '}
              <br className="hidden sm:inline" aria-hidden="true" />
              stripped of 70 kg and sharpened on the Nürburgring.
            </p>

            <button
              type="button"
              onClick={() => scrollToSection('performance')}
              className="cta-btn pointer-events-auto cursor-pointer"
            >
              Explore the M5 CS
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                focusable="false"
              >
                <path d="M4 12h15" />
                <path d="M13.5 5.5 20 12l-6.5 6.5" />
              </svg>
            </button>
          </section>
        </div>

        {/* ── Stage caption: FRONT (right side on desktop) ── */}
        <div
          ref={capFrontRef}
          data-scroll-copy=""
          style={{ opacity: 0 }}
          className={`absolute inset-x-5 bottom-28 max-w-[340px] [text-shadow:0_1px_14px_rgba(0,0,0,0.55)] sm:inset-x-auto sm:bottom-auto sm:right-[clamp(24px,7vw,110px)] sm:top-[38%] sm:text-right transition-opacity duration-300 ${
            orbitMode || cockpitMode ? 'opacity-0 pointer-events-none' : ''
          }`}
        >
          <p className="m-0 text-[11px] font-medium uppercase tracking-[0.32em] text-[#e8ddc4]/80">01 — Front Fascia</p>
          <h2 className="m-0 mt-2 text-[clamp(20px,3vw,32px)] font-semibold tracking-[-0.01em] text-[#f7f4ec]">
            Laserlight &amp; Kidney Grille
          </h2>
          <p className="m-0 mt-2 text-[13px] leading-relaxed text-white/55">
            Illuminated M Laserlights, widened kidneys and a carbon front splitter.
          </p>
        </div>

        {/* ── Stage caption: REAR (left side on desktop) ── */}
        <div
          ref={capRearRef}
          data-scroll-copy=""
          style={{ opacity: 0 }}
          className={`absolute inset-x-5 bottom-28 max-w-[340px] [text-shadow:0_1px_14px_rgba(0,0,0,0.55)] sm:inset-x-auto sm:bottom-auto sm:left-[clamp(24px,7vw,110px)] sm:top-[38%] transition-opacity duration-300 ${
            orbitMode || cockpitMode ? 'opacity-0 pointer-events-none' : ''
          }`}
        >
          <p className="m-0 text-[11px] font-medium uppercase tracking-[0.32em] text-[#e8ddc4]/80">02 — Rear Profile</p>
          <h2 className="m-0 mt-2 text-[clamp(20px,3vw,32px)] font-semibold tracking-[-0.01em] text-[#f7f4ec]">
            Diffuser &amp; Quad Exhaust
          </h2>
          <p className="m-0 mt-2 text-[13px] leading-relaxed text-white/55">
            Blacked-out taillights over a carbon diffuser and quad tailpipes.
          </p>
        </div>

        {/* ── X-Ray spec panel (right side; full-width strip on mobile) ── */}
        <div
          ref={xrayPanelRef}
          data-scroll-copy=""
          style={{ opacity: 0 }}
          className={`absolute inset-x-4 bottom-[92px] sm:inset-x-auto sm:bottom-auto sm:right-[clamp(20px,5vw,72px)] sm:top-1/2 sm:-translate-y-1/2 sm:w-[340px] transition-opacity duration-300 ${
            orbitMode || cockpitMode ? 'opacity-0 pointer-events-none' : ''
          }`}
        >
          <div
            ref={xrayScanRef}
            className="xray-panel relative overflow-hidden rounded-2xl border border-[#7fd3ff]/25 bg-[#050a12]/70 p-4 sm:p-5 backdrop-blur-md"
            style={{ '--scan': '0%' } as CSSProperties}
          >
            <div className="mb-3 flex items-center justify-between">
              <p className="m-0 text-[10px] font-semibold uppercase tracking-[0.32em] text-[#7fd3ff]">03 — X-Ray</p>
              <span className="xray-badge text-[10px] font-mono tracking-widest text-[#7fd3ff]/80">SCANNING</span>
            </div>
            <h2 className="m-0 mb-2 sm:mb-0 text-[clamp(16px,2.4vw,24px)] font-semibold tracking-[-0.01em] text-[#f7f4ec]">
              S63 TwinPower Turbo · CFRP shell
            </h2>
            <p className="m-0 mt-1 mb-3 sm:mb-4 hidden sm:block text-[12px] leading-relaxed text-white/50">
              Bodywork stripped to the frame — what is left is the drivetrain that makes it the fastest M5.
            </p>
            <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-1 sm:gap-y-2.5">
              {SPEC_STATS.map((stat, i) => {
                const v = xrayValues[i] ?? 0
                const shown = stat.decimals ? v.toFixed(stat.decimals) : Math.round(v).toLocaleString('en-US')
                const pct = stat.value > 0 ? Math.min(1, v / stat.value) : 0
                return (
                  <div key={stat.id} className="min-w-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <dt className="m-0 truncate text-[10px] uppercase tracking-[0.18em] text-white/45">{stat.label}</dt>
                      <dd className="m-0 whitespace-nowrap font-mono text-[15px] sm:text-[17px] font-semibold tabular-nums text-white">
                        {shown}
                        <span className="ml-1 text-[10px] font-normal text-[#7fd3ff]/80">{stat.unit}</span>
                      </dd>
                    </div>
                    <div className="mt-1 h-px w-full bg-white/10">
                      <div
                        className="h-px bg-gradient-to-r from-[#7fd3ff] to-[#7fd3ff]/20 transition-[width] duration-75"
                        style={{ width: `${pct * stat.bar * 100}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </dl>
          </div>
        </div>

        {/* ── Closing card ── */}
        <div
          ref={endCardRef}
          data-scroll-copy=""
          style={{ opacity: 0 }}
          className={`absolute inset-0 flex flex-col items-center justify-center px-6 text-center transition-opacity duration-300 ${
            orbitMode || cockpitMode ? 'opacity-0 pointer-events-none' : ''
          }`}
        >
          <p className="m-0 text-[11px] font-medium uppercase tracking-[0.4em] text-[#e8ddc4]/80">BMW M5 CS</p>
          <h2 className="m-0 mt-4 text-[clamp(24px,4.5vw,40px)] font-semibold tracking-[-0.02em] text-[#f7f4ec]">
            The most powerful M5 ever built.
          </h2>
          <button
            type="button"
            onClick={() => setShowBookingModal(true)}
            className="cta-btn pointer-events-auto mt-8 cursor-pointer"
          >
            <span>Reserve Yours</span>
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              focusable="false"
            >
              <path d="M4 12h15" />
              <path d="M13.5 5.5 20 12l-6.5 6.5" />
            </svg>
          </button>
        </div>

        {/* ── Advanced Studio & Vehicle Configurator Dock ── */}
        <ConfiguratorDock
          theme={theme}
          onThemeChange={handleThemeChange}
          highBeams={highBeams}
          onToggleHighBeams={toggleHighBeams}
          paint={paint}
          onPaintChange={handlePaintChange}
          orbitMode={orbitMode}
          onToggleOrbit={handleOrbitToggle}
          sceneId={sceneId}
          onSceneChange={handleSceneChange}
          onRandomScene={handleRandomScene}
          sceneFacts={sceneFacts}
          cockpitMode={cockpitMode}
          onToggleCockpit={handleCockpitToggle}
          showText={showText}
          onToggleText={handleToggleText}
        />

        {/* ── Cockpit HUD — exit + callouts ── */}
        <CockpitOverlay
          active={cockpitMode}
          onExit={handleCockpitToggle}
          callouts={COCKPIT_CALLOUTS}
        />
      </div>

      {/* ── Test Drive Reservation Modal ── */}
      {showBookingModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="booking-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xl animate-in fade-in duration-200"
        >
          <div className="relative w-full max-w-lg rounded-3xl border border-white/20 bg-[#0c0f16] p-6 sm:p-8 shadow-2xl">
            <button
              type="button"
              onClick={() => {
                setShowBookingModal(false)
                setBookingConfirmed(false)
              }}
              aria-label="Close modal"
              className="absolute top-5 right-5 rounded-full p-2 text-white/50 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>

            {bookingConfirmed ? (
              <div className="py-6 text-center">
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[#009ADA]/20 text-[#009ADA] border border-[#009ADA]/40">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                </div>
                <h3 className="m-0 mb-2 text-[22px] font-bold text-white">Reservation Request Confirmed</h3>
                <p className="m-0 mb-6 text-[14px] text-white/70 leading-relaxed">
                  A certified BMW M Client Advisor will reach out to coordinate your private session with the M5 CS in {PAINT_CONFIGS[paint].name}.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setShowBookingModal(false)
                    setBookingConfirmed(false)
                  }}
                  className="rounded-full bg-white px-6 py-2.5 text-[13px] font-semibold text-black hover:bg-white/90 transition-all cursor-pointer"
                >
                  Return to Experience
                </button>
              </div>
            ) : (
              <div>
                <div className="mb-6">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#FFB733]" />
                    <span className="text-[11px] font-bold uppercase tracking-[0.25em] text-[#e8ddc4]">
                      Private M Client Experience
                    </span>
                  </div>
                  <h3 id="booking-title" className="m-0 text-[24px] font-bold text-white tracking-tight">
                    Reserve Your M5 CS Session
                  </h3>
                  <p className="m-0 mt-1 text-[13px] text-white/60">
                    Selected finish: <strong className="text-white">{PAINT_CONFIGS[paint].name}</strong> · 627 HP Twin-Turbo V8
                  </p>
                </div>

                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    setBookingConfirmed(true)
                  }}
                  className="space-y-4"
                >
                  <div>
                    <label className="block text-[11px] font-semibold uppercase tracking-[0.16em] text-white/60 mb-1.5">
                      Full Name
                    </label>
                    <input
                      required
                      type="text"
                      placeholder="e.g. Marcus Vance"
                      className="w-full rounded-xl border border-white/15 bg-white/5 px-3.5 py-2.5 text-[13px] text-white placeholder:text-white/30 focus:border-white/40 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold uppercase tracking-[0.16em] text-white/60 mb-1.5">
                      Email Address
                    </label>
                    <input
                      required
                      type="email"
                      placeholder="m.vance@executive.com"
                      className="w-full rounded-xl border border-white/15 bg-white/5 px-3.5 py-2.5 text-[13px] text-white placeholder:text-white/30 focus:border-white/40 focus:outline-none"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold uppercase tracking-[0.16em] text-white/60 mb-1.5">
                        City / Region
                      </label>
                      <input
                        required
                        type="text"
                        placeholder="Munich, Germany"
                        className="w-full rounded-xl border border-white/15 bg-white/5 px-3.5 py-2.5 text-[13px] text-white placeholder:text-white/30 focus:border-white/40 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold uppercase tracking-[0.16em] text-white/60 mb-1.5">
                        Preferred Paint
                      </label>
                      <select
                        value={paint}
                        onChange={(e) => handlePaintChange(e.target.value as PaintFinish)}
                        className="w-full rounded-xl border border-white/15 bg-[#121620] px-3.5 py-2.5 text-[13px] text-white focus:border-white/40 focus:outline-none"
                      >
                        {(Object.keys(PAINT_CONFIGS) as PaintFinish[]).map((p) => (
                          <option key={p} value={p}>
                            {PAINT_CONFIGS[p].name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <button
                    type="submit"
                    className="w-full mt-2 rounded-xl bg-gradient-to-r from-[#1C69D4] to-[#009ADA] hover:from-[#185ec2] hover:to-[#0089c2] py-3 text-[13px] font-semibold text-white shadow-lg transition-all active:scale-[0.98] cursor-pointer"
                  >
                    Confirm Private Session Request
                  </button>
                </form>
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  )
}
