'use client'

import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { Canvas, useFrame } from '@react-three/fiber'
import { Billboard, ContactShadows, Environment, Lightformer, useGLTF } from '@react-three/drei'

/* ── Tuning constants ─────────────────────────────────────────────── */
const MODEL_URL = '/models/bmw-m5-cs/scene.gltf'
const DRIFT_RADIUS = 5.2 // donut radius
const OMEGA = 0.85 // rad/s around the circle
const SLIP = 0.55 // drift angle (rad) — nose points into the circle
const TARGET_LENGTH = 4.6 // normalized car length (world units)
const FLIP_MODEL = false // flip 180° if the model faces backwards

/* Shared channel: the car tells the smoke system where its rear tires are */
const carChannel = {
  ready: false, // flips true once the car writes its first frame
  rearLeft: new THREE.Vector3(),
  rearRight: new THREE.Vector3(),
}

/* ── Canvas-generated textures (no network needed) ────────────────── */
function makeSoftCircleTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 128
  const ctx = canvas.getContext('2d')!
  const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
  gradient.addColorStop(0, 'rgba(255,255,255,0.7)')
  gradient.addColorStop(0.25, 'rgba(255,255,255,0.45)')
  gradient.addColorStop(0.6, 'rgba(255,255,255,0.14)')
  gradient.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, 128, 128)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

function makeSkidTexture(): THREE.CanvasTexture {
  const size = 1024
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  const pxPerUnit = size / 34 // skid plane is 34×34 units
  ctx.translate(size / 2, size / 2)

  const drawRing = (radiusUnits: number, widthPx: number, alpha: number) => {
    const r = radiusUnits * pxPerUnit
    for (let i = 0; i < 240; i++) {
      const start = Math.random() * Math.PI * 2
      const len = 0.05 + Math.random() * 0.22
      ctx.strokeStyle = `rgba(7,8,10,${(alpha * (0.4 + Math.random() * 0.6)).toFixed(3)})`
      ctx.lineWidth = widthPx * (0.55 + Math.random() * 0.9)
      ctx.beginPath()
      ctx.arc(0, 0, r + (Math.random() - 0.5) * widthPx, start, start + len)
      ctx.stroke()
    }
  }
  drawRing(DRIFT_RADIUS - 0.7, 13, 0.17) // smeared rubber between the rears
  drawRing(DRIFT_RADIUS - 1.45, 5, 0.36) // left rear tire line
  drawRing(DRIFT_RADIUS + 0.1, 5, 0.36) // right rear tire line
  drawRing(DRIFT_RADIUS + 2.2, 6, 0.1) // older ghost donut
  drawRing(DRIFT_RADIUS - 2.6, 6, 0.09)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  return texture
}

/* ── Materials ────────────────────────────────────────────────────── */
const BODY_PAINT = new Set([
  'Bodyshell1Mtl',
  'Bonnet0041Mtl',
  'Bonnet1Mtl',
  'Boot0041Mtl',
  'DoorColor1Mtl',
])
const GLASS = new Set(['Windowrf1Mtl'])

const grayPaint = () =>
  new THREE.MeshPhysicalMaterial({
    color: '#9aa0a5',
    metalness: 0.82,
    roughness: 0.32,
    clearcoat: 1,
    clearcoatRoughness: 0.18,
    envMapIntensity: 1.25,
  })

const darkGlass = () =>
  new THREE.MeshPhysicalMaterial({
    color: '#06080b',
    metalness: 0.55,
    roughness: 0.1,
    clearcoat: 1,
    clearcoatRoughness: 0.06,
    envMapIntensity: 1.6,
  })

/* ── Model normalization (imperative three.js) ───────────────────── */
type CarBuild = {
  car: THREE.Group
  anchorLeft: THREE.Object3D
  anchorRight: THREE.Object3D
}

function buildCar(source: THREE.Object3D): CarBuild {
  const model = source.clone(true)

  // Normalize: center footprint, ground at y=0, longest horizontal
  // span = TARGET_LENGTH (axis-agnostic — works whatever the model's
  // native forward axis is)
  const box = new THREE.Box3().setFromObject(model)
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  const span = Math.max(size.x, size.z)
  const scale = TARGET_LENGTH / span
  model.scale.setScalar(scale)
  model.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale)
  if (FLIP_MODEL) model.rotation.y = Math.PI

  // Paint: gray body + dark glass; drop showroom floor plates if any
  const gray = grayPaint()
  const glass = darkGlass()
  const junk: THREE.Object3D[] = []
  model.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (!mesh.isMesh) return
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    let replaced = false
    for (let i = 0; i < mats.length; i++) {
      const name = (mats[i] as THREE.Material).name ?? ''
      if (BODY_PAINT.has(name)) {
        mats[i] = gray
        replaced = true
      } else if (GLASS.has(name)) {
        mats[i] = glass
        replaced = true
      }
    }
    if (replaced) mesh.material = Array.isArray(mesh.material) ? mats : mats[0]
    // hide giant flat plates (Sketchfab showroom floors)
    const b = new THREE.Box3().setFromObject(mesh)
    const sy = b.max.y - b.min.y
    const sx = b.max.x - b.min.x
    const sz = b.max.z - b.min.z
    if (sy < 0.12 && sx > 3 && sz > 3) junk.push(mesh)
  })
  junk.forEach((m) => (m.visible = false))

  const car = new THREE.Group()
  car.add(model)

  // Smoke anchors near the rear tire contact patches (rear = -X of the
  // drift root). The model's wheels stay static — at hero camera range
  // the slide, smoke and skid marks carry the motion.
  const axleX = TARGET_LENGTH * 0.3
  const trackZ = TARGET_LENGTH * 0.155
  const anchorLeft = new THREE.Object3D()
  anchorLeft.position.set(-axleX, 0.16, trackZ)
  const anchorRight = new THREE.Object3D()
  anchorRight.position.set(-axleX, 0.16, -trackZ)
  car.add(anchorLeft, anchorRight)

  return { car, anchorLeft, anchorRight }
}

/* ── The drifting M5 CS (real glTF model) ─────────────────────────── */
function DriftCar() {
  const gltf = useGLTF(MODEL_URL)
  const build = useMemo(() => buildCar(gltf.scene), [gltf.scene])
  // useFrame mutates the three.js objects through a ref (imperative
  // animation is the sanctioned R3F pattern; the ref satisfies the
  // react-hooks/immutability rule).
  const rig = useRef<CarBuild | null>(null)
  useEffect(() => {
    rig.current = build
  }, [build])
  const softTex = useMemo(() => makeSoftCircleTexture(), [])
  const root = useRef<THREE.Group>(null!)

  useFrame((state) => {
    const b = rig.current
    if (!b) return
    const elapsed = state.clock.elapsedTime
    const theta = elapsed * OMEGA

    // position on the donut
    const px = Math.cos(theta) * DRIFT_RADIUS
    const pz = Math.sin(theta) * DRIFT_RADIUS

    // drift heading = velocity tangent blended toward the circle center
    const tx = -Math.sin(theta)
    const tz = Math.cos(theta)
    const ix = -Math.cos(theta)
    const iz = -Math.sin(theta)
    const hx = tx + SLIP * ix
    const hz = tz + SLIP * iz
    root.current.position.set(px, 0, pz)
    root.current.rotation.y = Math.atan2(-hz, hx)

    // body roll (leans out of the circle), pitch wobble and bounce
    b.car.rotation.x = -0.035 + Math.sin(elapsed * 3.1) * 0.012
    b.car.rotation.z = Math.sin(elapsed * 2.2) * 0.01
    b.car.position.y = Math.abs(Math.sin(elapsed * 5.1)) * 0.018

    // publish rear-wheel world positions for the smoke system
    carChannel.ready = true
    b.anchorLeft.getWorldPosition(carChannel.rearLeft)
    b.anchorRight.getWorldPosition(carChannel.rearRight)
  })

  return (
    <group ref={root}>
      <primitive object={build.car}>
        {/* headlight glow */}
        {[0.55, -0.55].map((z) => (
          <Billboard key={`hl${z}`} position={[2.08, 0.58, z]}>
            <mesh>
              <planeGeometry args={[0.55, 0.55]} />
              <meshBasicMaterial
                map={softTex}
                color="#c7d6ef"
                transparent
                opacity={0.35}
                blending={THREE.AdditiveBlending}
                depthWrite={false}
              />
            </mesh>
          </Billboard>
        ))}
        {/* taillight glow */}
        {[0.55, -0.55].map((z) => (
          <Billboard key={`tl${z}`} position={[-2.12, 0.62, z]}>
            <mesh>
              <planeGeometry args={[0.5, 0.5]} />
              <meshBasicMaterial
                map={softTex}
                color="#ff4d4d"
                transparent
                opacity={0.24}
                blending={THREE.AdditiveBlending}
                depthWrite={false}
              />
            </mesh>
          </Billboard>
        ))}
      </primitive>
    </group>
  )
}

/* ── Tire smoke: GPU point sprites with per-particle size/alpha ───── */
const SMOKE_COUNT = 512

type Particle = {
  life: number
  maxLife: number
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  size: number
}

const SMOKE_VERTEX = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  uniform float uScale;
  varying float vAlpha;
  void main() {
    vAlpha = aAlpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uScale / max(0.1, -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`

const SMOKE_FRAGMENT = /* glsl */ `
  uniform sampler2D uMap;
  varying float vAlpha;
  void main() {
    float a = texture2D(uMap, gl_PointCoord).a * vAlpha;
    if (a < 0.004) discard;
    gl_FragColor = vec4(0.84, 0.86, 0.9, a);
  }
`

/*
 * Module-scope mutable store (the scene is a client-only singleton).
 * Particle pools and GPU buffers are mutated in place every frame — the
 * standard imperative three.js pattern; it never touches React state.
 */
function createSmokeStore() {
  const particles: Particle[] = Array.from({ length: SMOKE_COUNT }, () => ({
    life: 0,
    maxLife: 1,
    x: 0,
    y: -50,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    size: 1,
  }))
  const position = new Float32Array(SMOKE_COUNT * 3)
  const aSize = new Float32Array(SMOKE_COUNT)
  const aAlpha = new Float32Array(SMOKE_COUNT)
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3))
  geometry.setAttribute('aSize', new THREE.BufferAttribute(aSize, 1))
  geometry.setAttribute('aAlpha', new THREE.BufferAttribute(aAlpha, 1))
  return { particles, position, aSize, aAlpha, geometry, cursor: 0, spawnAcc: 0 }
}

const smokeStore = createSmokeStore()
const tmpVec2 = new THREE.Vector2()

function Smoke() {
  const materialRef = useRef<THREE.ShaderMaterial>(null!)
  const softTex = useMemo(() => makeSoftCircleTexture(), [])

  useFrame((state, rawDt) => {
    const { particles, position, aSize, aAlpha, geometry } = smokeStore
    const dt = Math.min(rawDt, 0.05)
    const elapsed = state.clock.elapsedTime
    const theta = elapsed * OMEGA
    const ox = -Math.cos(theta) // radial outward
    const oz = -Math.sin(theta)

    // spawn ~240 particles/s, alternating rear wheels — only once the
    // car is live, never against the unloaded (0,0,0) channel
    if (carChannel.ready) smokeStore.spawnAcc += dt * 240
    while (smokeStore.spawnAcc >= 1) {
      smokeStore.spawnAcc -= 1
      smokeStore.cursor = (smokeStore.cursor + 1) % SMOKE_COUNT
      const p = particles[smokeStore.cursor]
      const src = smokeStore.cursor % 2 === 0 ? carChannel.rearLeft : carChannel.rearRight
      p.life = 0.0001
      p.maxLife = 2.2 + Math.random() * 1.4
      p.x = src.x + (Math.random() - 0.5) * 0.24
      p.y = 0.12 + Math.random() * 0.08
      p.z = src.z + (Math.random() - 0.5) * 0.24
      p.vx = ox * (0.7 + Math.random() * 0.8) + (Math.random() - 0.5) * 0.9
      p.vz = oz * (0.7 + Math.random() * 0.8) + (Math.random() - 0.5) * 0.9
      p.vy = 0.18 + Math.random() * 0.3
      p.size = 0.55 + Math.random() * 0.4
    }

    // integrate + write buffers
    for (let i = 0; i < SMOKE_COUNT; i++) {
      const p = particles[i]
      if (p.life > 0) {
        p.life += dt
        if (p.life >= p.maxLife) {
          p.life = 0
        } else {
          const drag = Math.exp(-1.1 * dt)
          p.vx *= drag
          p.vz *= drag
          p.vy = p.vy * Math.exp(-0.7 * dt) + 0.14 * dt
          p.x += p.vx * dt
          p.y += p.vy * dt
          p.z += p.vz * dt
        }
      }
      const t = p.life > 0 ? p.life / p.maxLife : 0
      position[i * 3] = p.x
      position[i * 3 + 1] = p.life > 0 ? p.y : -50
      position[i * 3 + 2] = p.z
      aSize[i] = p.size + t * 4.2
      aAlpha[i] = p.life > 0 ? Math.min(t * 6, 1) * Math.pow(1 - t, 1.1) * 0.6 : 0
    }
    geometry.attributes.position.needsUpdate = true
    geometry.attributes.aSize.needsUpdate = true
    geometry.attributes.aAlpha.needsUpdate = true

    // point-size scale so smoke keeps its world size at any resolution
    const camera = state.camera as THREE.PerspectiveCamera
    const fov = (camera.fov * Math.PI) / 180
    state.gl.getDrawingBufferSize(tmpVec2)
    const uScale = tmpVec2.y * 0.5 / Math.tan(fov / 2)
    materialRef.current.uniforms.uScale.value = Number.isFinite(uScale) ? uScale : 800
  })

  return (
    <points frustumCulled={false} geometry={smokeStore.geometry}>
      <shaderMaterial
        ref={materialRef}
        args={[
          {
            uniforms: { uScale: { value: 600 }, uMap: { value: softTex } },
            vertexShader: SMOKE_VERTEX,
            fragmentShader: SMOKE_FRAGMENT,
            transparent: true,
            depthWrite: false,
          },
        ]}
      />
    </points>
  )
}

/* ── Ground + baked skid marks ────────────────────────────────────── */
function Ground() {
  const skidTex = useMemo(() => makeSkidTexture(), [])
  return (
    <>
      <mesh rotation-x={-Math.PI / 2}>
        <circleGeometry args={[80, 96]} />
        <meshStandardMaterial color="#191c22" roughness={0.96} metalness={0.05} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={0.008}>
        <planeGeometry args={[34, 34]} />
        <meshBasicMaterial map={skidTex} transparent depthWrite={false} opacity={0.85} />
      </mesh>
    </>
  )
}

/* ── Fixed cinematic camera with pointer parallax ─────────────── */
const CAM_BASE = new THREE.Vector3(11.0, 4.3, 11.0)
const CAM_LOOK = new THREE.Vector3(0, 0.55, 0)

function Rig() {
  const lookAt = useMemo(() => new THREE.Vector3(), [])
  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.05)
    // Wide 3/4 hero angle over the whole donut; the pointer adds a
    // gentle parallax so the scene feels alive without chasing the car.
    lookAt.copy(CAM_LOOK)
    // pull the camera back on narrow/portrait viewports so the whole
    // donut stays in frame
    const aspect = state.size.width / state.size.height
    const zoom = aspect < 0.75 ? 1.5 : aspect < 1.1 ? 1.25 : 1
    const px = state.pointer.x * 0.8
    const py = state.pointer.y * 0.45
    const targetX = CAM_BASE.x * zoom + px
    const targetY = CAM_BASE.y * zoom + py
    const targetZ = CAM_BASE.z * zoom - px * 0.4
    state.camera.position.x += (targetX - state.camera.position.x) * (1 - Math.pow(0.0015, dt))
    state.camera.position.y += (targetY - state.camera.position.y) * (1 - Math.pow(0.0015, dt))
    state.camera.position.z += (targetZ - state.camera.position.z) * (1 - Math.pow(0.0015, dt))
    state.camera.lookAt(lookAt)
  })
  return null
}

/* ── Scene root ───────────────────────────────────────────────────── */
export default function BmwDriftScene() {
  return (
    <div className="absolute inset-0" aria-hidden="true">
      <Canvas
        dpr={[1, 1.5]}
        camera={{ position: [11.0, 4.3, 11.0], fov: 40, near: 0.1, far: 160 }}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      >
        <color attach="background" args={['#0d1017']} />
        <fogExp2 attach="fog" args={['#0d1017', 0.028]} />
        <ambientLight intensity={0.4} />
        <directionalLight position={[7, 11, 5]} intensity={1.45} color="#fff3e2" />
        <directionalLight position={[-9, 5, -7]} intensity={0.55} color="#a9bede" />
        <pointLight position={[0, 3.4, 0]} intensity={9} distance={9} color="#ffd9a8" />

        <Suspense fallback={null}>
          <DriftCar />
        </Suspense>
        <Smoke />
        <Ground />
        <ContactShadows
          position={[0, 0.015, 0]}
          opacity={0.72}
          scale={17}
          blur={2.6}
          far={4.5}
          resolution={256}
          color="#04050a"
        />
        <Environment resolution={128} frames={1}>
          <Lightformer intensity={2.2} rotation-x={Math.PI / 2} position={[0, 6, 0]} scale={[12, 12, 1]} color="#f4f6fb" />
          <Lightformer intensity={1.1} position={[-6, 2.5, -4]} scale={[7, 2.5, 1]} rotation-y={Math.PI / 3} color="#b8c8e8" />
          <Lightformer intensity={1.4} position={[6, 2.2, 5]} scale={[7, 2.5, 1]} rotation-y={-Math.PI / 3} color="#ffd9a3" />
        </Environment>
        <Rig />
      </Canvas>
    </div>
  )
}

useGLTF.preload(MODEL_URL)
