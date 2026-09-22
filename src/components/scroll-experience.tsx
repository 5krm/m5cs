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
 *   0.00–0.30  HERO → FRONT   wide drift pose →    hero copy fades out
 *                             low, tight nose      front caption in/out
 *   0.42–0.72  FRONT → REAR   sweep along flank    rear caption in/out
 *   0.84–1.00  REAR → OUTRO   pull back wide       closing card fades in
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
 * overlay) driven by an invisible 440vh scroll track — functionally a
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
  PAINT_CONFIGS,
  WHEEL_CONFIGS,
  CALIPER_CONFIGS,
} from '@/types/configurator'
import ConfiguratorDock from '@/components/configurator-dock'

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
}

const KEYS = {
  /** 0% — wide drifting presentation, slightly high 3/4 iso */
  hero: { pos: [7.2, 2.9, 7.4], target: [0, 0.55, 0], mobileF: 1.35 },
  /** state 1 — dramatic low angle on the front bumper / headlights */
  front: { pos: [4.4, 0.5, 2.1], target: [2.0, 0.52, 0], mobileF: 2.15, mobileHeadOn: 0.45 },
  /** state 2 — rear taillights, diffuser and exhaust, same-side sweep */
  rear: { pos: [-4.3, 0.9, 2.2], target: [-1.9, 0.68, 0], mobileF: 2.0, mobileHeadOn: 0.45 },
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
  setCarbonHood: (carbon: boolean) => void
  setPaintColor: (paint: PaintFinish) => void
}

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

  model.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return
    obj.castShadow = true
    obj.receiveShadow = false

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

  let isCarbonHoodExposed = false
  const setCarbonHood = (carbon: boolean) => {
    isCarbonHoodExposed = carbon
    bonnetMeshes.forEach((mesh) => {
      mesh.material = carbon ? carbonMat : basePaint
    })
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
    if (!isCarbonHoodExposed) {
      bonnetMeshes.forEach((mesh) => {
        mesh.material = basePaint
      })
    }
  }

  return {
    car,
    paintMaterials,
    setHoodOpen,
    setDoorOpen,
    setWheelFinish,
    setCaliperColor,
    setCarbonHood,
    setPaintColor,
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

/** Flatten a keyframe; on portrait screens the pos→target offset is
 *  scaled by mobileF so the car never clips out of the narrow viewport. */
function flattenKey(k: CamKey, mobile: boolean): FlatKey {
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
  { id: 'specs', label: 'Specs' },
] as const

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
  const endCardRef = useRef<HTMLDivElement>(null)

  const [theme, setTheme] = useState<StudioTheme>('apex')
  const [highBeams, setHighBeams] = useState(true)
  const [paint, setPaint] = useState<PaintFinish>('brands-hatch-grey')
  const [wheelFinish, setWheelFinish] = useState<WheelFinish>('gold-bronze')
  const [caliperColor, setCaliperColor] = useState<CaliperColor>('red')
  const [carbonHood, setCarbonHood] = useState(false)
  const [hoodOpen, setHoodOpen] = useState(false)
  const [doorOpen, setDoorOpen] = useState(false)
  const [orbitMode, setOrbitMode] = useState(false)
  const [activeSection, setActiveSection] = useState<SectionId>('overview')
  const [scrollProgress, setScrollProgress] = useState(0)
  const [showBookingModal, setShowBookingModal] = useState(false)
  const [bookingConfirmed, setBookingConfirmed] = useState(false)

  const lenisInstanceRef = useRef<Lenis | null>(null)
  const updateThemeRef = useRef<((t: StudioTheme, hb: boolean) => void) | null>(null)
  const updatePaintRef = useRef<((p: PaintFinish) => void) | null>(null)
  const updateWheelRef = useRef<((w: WheelFinish) => void) | null>(null)
  const updateCaliperRef = useRef<((c: CaliperColor) => void) | null>(null)
  const toggleCarbonHoodRef = useRef<((c: boolean) => void) | null>(null)
  const toggleHoodRef = useRef<((open: boolean) => void) | null>(null)
  const toggleDoorRef = useRef<((open: boolean) => void) | null>(null)
  const toggleOrbitRef = useRef<((active: boolean) => void) | null>(null)
  const mouseRef = useRef({ x: 0, y: 0, targetX: 0, targetY: 0 })

  const scrollToSection = useCallback((section: SectionId) => {
    const track = trackRef.current
    if (!track) return
    const maxScroll = track.offsetHeight - window.innerHeight
    let target = 0
    if (section === 'overview') target = 0
    else if (section === 'performance') target = maxScroll * 0.32
    else if (section === 'design') target = maxScroll * 0.65
    else if (section === 'specs') target = maxScroll * 0.98

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

  const handleToggleCarbonHood = useCallback(() => {
    setCarbonHood((prev) => {
      const next = !prev
      toggleCarbonHoodRef.current?.(next)
      return next
    })
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
    setOrbitMode((prev) => {
      const next = !prev
      toggleOrbitRef.current?.(next)
      return next
    })
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    const track = trackRef.current
    const heroLayer = heroLayerRef.current
    const capFront = capFrontRef.current
    const capRear = capRearRef.current
    const endCard = endCardRef.current
    if (
      !canvas ||
      !track ||
      !heroLayer ||
      !capFront ||
      !capRear ||
      !endCard
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

    scene.add(new THREE.HemisphereLight(0x39404e, 0x0b0c10, 0.42)) // studio ambience

    /* ── Suspended architectural luminaire canopy (Next-Level Overhead Studio) ──
     * A structural floating truss system with high-output emissive diffuser panels,
     * chamfered dark metallic bezels, M-aerodynamic angled winglet strips,
     * and high-tension steel suspension cables vanishing into the ceiling fog. */
    const canopyGroup = new THREE.Group()
    canopyGroup.position.set(0, 5.35, 0)
    scene.add(canopyGroup)

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
    scene.add(cyclorama)

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

      scene.add(pGroup)

      // Reflected pylon below floor
      if (window.innerWidth >= 768) {
        const mirrorPGroup = pGroup.clone()
        mirrorPGroup.position.set(px, -ph / 2, pz)
        scene.add(mirrorPGroup)
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
      scene.add(shaft)

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
      scene.add(dust)
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
    scene.add(floor)

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
    scene.add(pool)

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
    const applyTheme = (t: StudioTheme, hb: boolean) => {
      backdropTex.dispose()
      const newBackdrop = makeStudioBackdropTexture(t)
      scene.background = newBackdrop

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
        key.color.setHex(0xeaf5ff)
        rim.color.setHex(0x009ada)
        diffuserMat.color.setHex(0xd0e8ff)
        wingMat.color.setHex(0x009ada)
      } else if (t === 'night') {
        key.color.setHex(0xd0e6ff)
        rim.color.setHex(0x2860a8)
        diffuserMat.color.setHex(0xc0ddff)
        wingMat.color.setHex(0x89cff0)
      } else {
        key.color.setHex(0xfff1dd)
        rim.color.setHex(0xbfd0e8)
        diffuserMat.color.setHex(0xffeedb)
        wingMat.color.setHex(0xffeedb)
      }

      headlightBeam.material.map?.dispose()
      headlightBeam.material.map = makeHeadlightProjectionTexture(t)
      headlightBeam.material.opacity = hb ? 0.85 : 0.15
      headlightBeam.material.needsUpdate = true

      taillightBeam.material.opacity = hb ? 0.75 : 0.15
      taillightBeam.material.needsUpdate = true
    }
    updateThemeRef.current = applyTheme

    let carRig: CarRig | null = null

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
        toggleCarbonHoodRef.current = (carbon: boolean) => {
          carRig?.setCarbonHood(carbon)
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
        }

        gsap.to(carRig!.car.position, { y: 0, duration: 0.8, ease: 'power2.out' })
      } catch (err) {
        console.warn('[scroll-experience] car model failed to load:', err)
      }
    })()

    /* ── Camera rig state — animated by GSAP or Orbit Drag ─────────── */
    const cam: FlatKey = { px: 0, py: 0, pz: 0, tx: 0, ty: 0, tz: 0 }

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
      if (!isOrbitActive) return
      orbitState.isDragging = true
      orbitState.lastX = e.clientX
      orbitState.lastY = e.clientY
    }

    const onPointerMove = (e: PointerEvent) => {
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
            if (p < 0.2) {
              setActiveSection('overview')
            } else if (p < 0.5) {
              setActiveSection('performance')
            } else if (p < 0.8) {
              setActiveSection('design')
            } else {
              setActiveSection('specs')
            }
          },
        },
      })

      /* Act I — HERO → FRONT (0 → 0.30) */
      tl.to(cam, { ...K.front, duration: 0.3 }, 0)
      tl.to(heroLayer, { autoAlpha: 0, y: -36, duration: 0.12, ease: 'power1.in' }, 0.02)
      tl.fromTo(capFront, { autoAlpha: 0, y: 32, scale: 0.98 }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.09, ease: 'power2.out' }, 0.15)
      tl.to(capFront, { autoAlpha: 0, y: -24, scale: 0.98, duration: 0.08, ease: 'power1.in' }, 0.38)

      /* dwell on the front bumper (0.30 → 0.42) — no camera tweens */

      /* Act II — FRONT → REAR (0.42 → 0.72) */
      tl.to(cam, { ...K.rear, duration: 0.3 }, 0.42)
      tl.fromTo(capRear, { autoAlpha: 0, y: 32, scale: 0.98 }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.09, ease: 'power2.out' }, 0.54)
      tl.to(capRear, { autoAlpha: 0, y: -24, scale: 0.98, duration: 0.08, ease: 'power1.in' }, 0.78)

      /* dwell on the rear (0.72 → 0.84) */

      /* Act III — REAR → OUTRO (0.84 → 1.00) + closing card */
      tl.to(cam, { ...K.outro, duration: 0.16 }, 0.84)
      tl.fromTo(endCard, { autoAlpha: 0, y: 28, scale: 0.98 }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.1, ease: 'power2.out' }, 0.87)

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

    const tick = (time: number) => {
      lenis?.raf(time * 1000)
      applyCamera()
      updateDust?.(time)
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
      backdropTex.dispose()
      poolTex.dispose()
      envTex.dispose()
      pmrem.dispose()
      renderer.forceContextLoss()
      renderer.dispose()
    }
  }, [])

  /* ═══════════════════ Overlay markup (fixed stage) ═══════════════════ */

  return (
    <main className="relative w-full bg-[#050608] text-[#f2efe7]">
      {/*
        Invisible scroll track — its height (440vh) is the scroll distance
        ScrollTrigger scrubs the camera timeline through. Fully reversible.
      */}
      <div ref={trackRef} aria-hidden="true" className="h-[440vh]" />

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
          className={`absolute inset-0 flex flex-col transition-opacity duration-300 ${
            orbitMode ? 'opacity-0 pointer-events-none' : ''
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
          style={{ opacity: 0 }}
          className={`absolute inset-x-5 bottom-28 max-w-[340px] [text-shadow:0_1px_14px_rgba(0,0,0,0.55)] sm:inset-x-auto sm:bottom-auto sm:right-[clamp(24px,7vw,110px)] sm:top-[38%] sm:text-right transition-opacity duration-300 ${
            orbitMode ? 'opacity-0 pointer-events-none' : ''
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
          style={{ opacity: 0 }}
          className={`absolute inset-x-5 bottom-28 max-w-[340px] [text-shadow:0_1px_14px_rgba(0,0,0,0.55)] sm:inset-x-auto sm:bottom-auto sm:left-[clamp(24px,7vw,110px)] sm:top-[38%] transition-opacity duration-300 ${
            orbitMode ? 'opacity-0 pointer-events-none' : ''
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

        {/* ── Closing card ── */}
        <div
          ref={endCardRef}
          style={{ opacity: 0 }}
          className={`absolute inset-0 flex flex-col items-center justify-center px-6 text-center transition-opacity duration-300 ${
            orbitMode ? 'opacity-0 pointer-events-none' : ''
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
          carbonHood={carbonHood}
          onToggleCarbonHood={handleToggleCarbonHood}
          orbitMode={orbitMode}
          onToggleOrbit={handleOrbitToggle}
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
