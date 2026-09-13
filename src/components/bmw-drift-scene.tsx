'use client'

import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { Canvas, useFrame } from '@react-three/fiber'
import { Billboard, ContactShadows, Environment, Lightformer } from '@react-three/drei'

/* ── Tuning constants ─────────────────────────────────────────────── */
const DRIFT_RADIUS = 5.2 // donut radius
const OMEGA = 0.85 // rad/s around the circle
const SLIP = 0.55 // drift angle (rad) — nose points into the circle

/* Shared channel: the car writes positions, smoke/camera read them */
const carChannel = {
  center: new THREE.Vector3(),
  yaw: 0,
  rearLeft: new THREE.Vector3(),
  rearRight: new THREE.Vector3(),
}

/* ── Canvas-generated textures (no network needed) ────────────────── */
function makeSoftCircleTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 128
  const ctx = canvas.getContext('2d')!
  const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
  gradient.addColorStop(0, 'rgba(255,255,255,0.95)')
  gradient.addColorStop(0.4, 'rgba(255,255,255,0.5)')
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

function makeRoundelTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 64
  const ctx = canvas.getContext('2d')!
  ctx.beginPath()
  ctx.arc(32, 32, 31, 0, Math.PI * 2)
  ctx.fillStyle = '#0a0c0e'
  ctx.fill()
  ctx.beginPath()
  ctx.arc(32, 32, 25, 0, Math.PI * 2)
  ctx.fillStyle = '#e9edf3'
  ctx.fill()
  ctx.fillStyle = '#2a6fd6'
  ctx.beginPath()
  ctx.moveTo(32, 32)
  ctx.arc(32, 32, 25, Math.PI, Math.PI * 1.5) // top-left quadrant
  ctx.closePath()
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(32, 32)
  ctx.arc(32, 32, 25, 0, Math.PI * 0.5) // bottom-right quadrant
  ctx.closePath()
  ctx.fill()
  ctx.beginPath()
  ctx.arc(32, 32, 7, 0, Math.PI * 2)
  ctx.fillStyle = '#101318'
  ctx.fill()
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

/* ── Car geometry: extruded side profile (x = forward, y = up) ────── */
function useCarGeometries() {
  return useMemo(() => {
    const body = new THREE.Shape()
    body.moveTo(-2.02, 0.16)
    body.lineTo(-2.1, 0.42)
    body.quadraticCurveTo(-2.12, 0.62, -1.95, 0.7)
    body.lineTo(-1.35, 0.76)
    body.quadraticCurveTo(-0.4, 0.83, 0.5, 0.8)
    body.quadraticCurveTo(1.5, 0.74, 1.86, 0.62)
    body.quadraticCurveTo(2.1, 0.55, 2.1, 0.38)
    body.lineTo(2.04, 0.16)
    body.lineTo(1.78, 0.16)
    body.absarc(1.32, 0.16, 0.46, 0, Math.PI, false) // front wheel arch
    body.lineTo(-0.86, 0.16)
    body.absarc(-1.32, 0.16, 0.46, 0, Math.PI, false) // rear wheel arch
    body.lineTo(-2.02, 0.16)
    const bodyGeometry = new THREE.ExtrudeGeometry(body, {
      depth: 1.86,
      bevelEnabled: true,
      bevelThickness: 0.06,
      bevelSize: 0.05,
      bevelSegments: 3,
      curveSegments: 16,
    })
    bodyGeometry.translate(0, 0, -0.93)

    const glass = new THREE.Shape()
    glass.moveTo(0.52, 0.78)
    glass.quadraticCurveTo(0.18, 1.08, -0.1, 1.12)
    glass.lineTo(-0.95, 1.13)
    glass.quadraticCurveTo(-1.3, 1.02, -1.5, 0.78)
    glass.lineTo(0.52, 0.78)
    const glassGeometry = new THREE.ExtrudeGeometry(glass, {
      depth: 1.6,
      bevelEnabled: true,
      bevelThickness: 0.04,
      bevelSize: 0.03,
      bevelSegments: 2,
      curveSegments: 12,
    })
    glassGeometry.translate(0, -0.015, -0.8)

    return { bodyGeometry, glassGeometry }
  }, [])
}

/* ── Wheel: torus tire + recessed barrel + spokes + red caliper ───── */
function WheelAssembly({
  position,
  steerRef,
  spinRef,
}: {
  position: [number, number, number]
  steerRef: React.RefObject<THREE.Group | null>
  spinRef: React.RefObject<THREE.Group | null>
}) {
  const side = Math.sign(position[2]) || 1
  const spokes = useMemo(() => Array.from({ length: 5 }, (_, i) => (i * Math.PI * 2) / 5), [])
  return (
    <group ref={steerRef} position={position}>
      <group ref={spinRef}>
        <mesh>
          <torusGeometry args={[0.26, 0.085, 14, 36]} />
          <meshStandardMaterial color="#0d0e11" roughness={0.92} />
        </mesh>
        <mesh rotation-x={Math.PI / 2}>
          <cylinderGeometry args={[0.185, 0.185, 0.14, 24]} />
          <meshStandardMaterial color="#1d2126" metalness={0.8} roughness={0.4} />
        </mesh>
        {/* brake disc visible through the spokes */}
        <mesh rotation-x={Math.PI / 2}>
          <cylinderGeometry args={[0.15, 0.15, 0.05, 24]} />
          <meshStandardMaterial color="#43484f" metalness={0.9} roughness={0.35} />
        </mesh>
        {spokes.map((angle) => (
          <mesh
            key={angle}
            position={[Math.sin(angle) * 0.13, Math.cos(angle) * 0.13, side * 0.1]}
            rotation-z={-angle}
          >
            <boxGeometry args={[0.06, 0.3, 0.045]} />
            <meshStandardMaterial color="#14161a" metalness={0.85} roughness={0.32} />
          </mesh>
        ))}
        <mesh position={[0, 0, side * 0.115]}>
          <torusGeometry args={[0.2, 0.018, 10, 32]} />
          <meshStandardMaterial color="#1b1e23" metalness={0.9} roughness={0.3} />
        </mesh>
        <mesh position={[0, 0, side * 0.1]} rotation-x={Math.PI / 2}>
          <cylinderGeometry args={[0.05, 0.05, 0.04, 16]} />
          <meshStandardMaterial color="#26292f" metalness={0.85} roughness={0.32} />
        </mesh>
      </group>
      {/* red M caliper — steers with the knuckle, never spins */}
      <mesh position={[0.15, 0.1, 0]} rotation-z={-0.5}>
        <boxGeometry args={[0.2, 0.15, 0.11]} />
        <meshStandardMaterial color="#cf2b31" metalness={0.35} roughness={0.45} />
      </mesh>
    </group>
  )
}

/* ── The drifting M5 CS ───────────────────────────────────────────── */
function DriftCar() {
  const root = useRef<THREE.Group>(null!)
  const bodyTilt = useRef<THREE.Group>(null!)
  const steerFL = useRef<THREE.Group>(null)
  const steerFR = useRef<THREE.Group>(null)
  const steerRL = useRef<THREE.Group>(null)
  const steerRR = useRef<THREE.Group>(null)
  const spinFL = useRef<THREE.Group>(null)
  const spinFR = useRef<THREE.Group>(null)
  const spinRL = useRef<THREE.Group>(null)
  const spinRR = useRef<THREE.Group>(null)
  const { bodyGeometry, glassGeometry } = useCarGeometries()
  const roundel = useMemo(() => makeRoundelTexture(), [])

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.05)
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

    // opposite-lock counter steer with a hint of correction wobble
    const steer = -SLIP * 1.35 + Math.sin(elapsed * 7.3) * 0.035
    if (steerFL.current) steerFL.current.rotation.y = steer
    if (steerFR.current) steerFR.current.rotation.y = steer

    // wheel rotation — rears spinning well past ground speed
    if (spinFL.current) spinFL.current.rotation.z += dt * 14
    if (spinFR.current) spinFR.current.rotation.z += dt * 14
    if (spinRL.current) spinRL.current.rotation.z += dt * 30
    if (spinRR.current) spinRR.current.rotation.z += dt * 30

    // body roll (leans out of the circle), pitch wobble and bounce
    bodyTilt.current.rotation.x = -0.035 + Math.sin(elapsed * 3.1) * 0.012
    bodyTilt.current.rotation.z = Math.sin(elapsed * 2.2) * 0.01
    bodyTilt.current.position.y = Math.abs(Math.sin(elapsed * 5.1)) * 0.018

    // publish car-center + rear-wheel world positions for smoke & camera
    carChannel.center.set(px, 0, pz)
    carChannel.yaw = root.current.rotation.y
    if (steerRL.current) steerRL.current.getWorldPosition(carChannel.rearLeft)
    if (steerRR.current) steerRR.current.getWorldPosition(carChannel.rearRight)
  })

  return (
    <group ref={root}>
      <group ref={bodyTilt}>
        {/* painted body */}
        <mesh geometry={bodyGeometry}>
          <meshPhysicalMaterial
            color="#9aa0a5"
            metalness={0.8}
            roughness={0.3}
            clearcoat={1}
            clearcoatRoughness={0.2}
            envMapIntensity={1.25}
          />
        </mesh>
        {/* dark glasshouse (carbon-roof CS look) */}
        <mesh geometry={glassGeometry}>
          <meshPhysicalMaterial
            color="#07090c"
            metalness={0.45}
            roughness={0.12}
            clearcoat={1}
            clearcoatRoughness={0.08}
            envMapIntensity={1.7}
          />
        </mesh>

        {/* big gloss-black kidneys with mesh slats */}
        {[0.2, -0.2].map((z) => (
          <group key={z} position={[2.07, 0.42, z]} rotation-y={z > 0 ? -0.16 : 0.16}>
            <mesh>
              <boxGeometry args={[0.05, 0.26, 0.36]} />
              <meshStandardMaterial color="#060708" metalness={0.5} roughness={0.5} />
            </mesh>
            {[0.08, 0, -0.08].map((sy) => (
              <mesh key={sy} position={[0.025, sy, 0]}>
                <boxGeometry args={[0.02, 0.028, 0.3]} />
                <meshStandardMaterial color="#2a2d33" metalness={0.7} roughness={0.4} />
              </mesh>
            ))}
          </group>
        ))}

        {/* angular white LED headlights + cool glow */}
        {[0.6, -0.6].map((z) => (
          <group key={z}>
            <mesh position={[1.84, 0.58, z]} rotation-y={z > 0 ? -0.42 : 0.42}>
              <boxGeometry args={[0.1, 0.055, 0.34]} />
              <meshStandardMaterial color="#0a0d14" emissive="#cfe0ff" emissiveIntensity={2.4} />
            </mesh>
            <Billboard position={[1.97, 0.58, z]}>
              <mesh>
                <planeGeometry args={[0.5, 0.5]} />
                <meshBasicMaterial
                  map={makeSoftCircleTexture()}
                  color="#bcd2ff"
                  transparent
                  opacity={0.32}
                  blending={THREE.AdditiveBlending}
                  depthWrite={false}
                />
              </mesh>
            </Billboard>
          </group>
        ))}

        {/* slim taillights + glow */}
        {[0.55, -0.55].map((z) => (
          <group key={z}>
            <mesh position={[-2.08, 0.6, z]}>
              <boxGeometry args={[0.05, 0.07, 0.52]} />
              <meshStandardMaterial color="#160404" emissive="#e02626" emissiveIntensity={1.9} />
            </mesh>
            <Billboard position={[-2.16, 0.6, z]}>
              <mesh>
                <planeGeometry args={[0.5, 0.5]} />
                <meshBasicMaterial
                  map={makeSoftCircleTexture()}
                  color="#ff4d4d"
                  transparent
                  opacity={0.22}
                  blending={THREE.AdditiveBlending}
                  depthWrite={false}
                />
              </mesh>
            </Billboard>
          </group>
        ))}

        {/* mirrors */}
        {[1.0, -1.0].map((z) => (
          <mesh key={z} position={[0.42, 0.88, z]}>
            <boxGeometry args={[0.12, 0.07, 0.16]} />
            <meshStandardMaterial color="#101114" metalness={0.6} roughness={0.25} />
          </mesh>
        ))}

        {/* front splitter + rear diffuser */}
        <mesh position={[2.02, 0.1, 0]}>
          <boxGeometry args={[0.44, 0.05, 1.94]} />
          <meshStandardMaterial color="#0b0c0e" metalness={0.4} roughness={0.5} />
        </mesh>
        {/* gloss black side skirts */}
        {[0.965, -0.965].map((z) => (
          <mesh key={z} position={[0, 0.16, z]}>
            <boxGeometry args={[2.45, 0.06, 0.06]} />
            <meshStandardMaterial color="#0c0d0f" metalness={0.5} roughness={0.45} />
          </mesh>
        ))}
        {/* shark fin antenna */}
        <mesh position={[-1.02, 1.17, 0]}>
          <boxGeometry args={[0.26, 0.06, 0.07]} />
          <meshStandardMaterial color="#0c0d0f" metalness={0.5} roughness={0.4} />
        </mesh>
        <mesh position={[-1.98, 0.14, 0]}>
          <boxGeometry args={[0.3, 0.08, 1.7]} />
          <meshStandardMaterial color="#0b0c0e" metalness={0.4} roughness={0.6} />
        </mesh>

        {/* quad exhaust tips */}
        {[0.28, 0.44, -0.28, -0.44].map((z) => (
          <mesh key={z} position={[-2.07, 0.27, z]} rotation-z={Math.PI / 2}>
            <cylinderGeometry args={[0.045, 0.045, 0.14, 14]} />
            <meshStandardMaterial color="#2c2f34" metalness={0.9} roughness={0.3} />
          </mesh>
        ))}

        {/* roundels front + rear */}
        <mesh position={[2.02, 0.52, 0]} rotation-z={Math.PI / 2}>
          <cylinderGeometry args={[0.08, 0.08, 0.02, 20]} />
          <meshStandardMaterial map={roundel} metalness={0.3} roughness={0.4} />
        </mesh>
        <mesh position={[-2.02, 0.68, 0]} rotation-z={Math.PI / 2}>
          <cylinderGeometry args={[0.08, 0.08, 0.02, 20]} />
          <meshStandardMaterial map={roundel} metalness={0.3} roughness={0.4} />
        </mesh>
      </group>

      {/* wheels — attached to the yaw group so the body rolls independently */}
      <WheelAssembly position={[1.32, 0.345, 0.86]} steerRef={steerFL} spinRef={spinFL} />
      <WheelAssembly position={[1.32, 0.345, -0.86]} steerRef={steerFR} spinRef={spinFR} />
      <WheelAssembly position={[-1.32, 0.345, 0.86]} steerRef={steerRL} spinRef={spinRL} />
      <WheelAssembly position={[-1.32, 0.345, -0.86]} steerRef={steerRR} spinRef={spinRR} />
    </group>
  )
}

/* ── Tire smoke: GPU point sprites with per-particle size/alpha ───── */
const SMOKE_COUNT = 320

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

    // spawn ~165 particles/s, alternating rear wheels
    smokeStore.spawnAcc += dt * 165
    while (smokeStore.spawnAcc >= 1) {
      smokeStore.spawnAcc -= 1
      smokeStore.cursor = (smokeStore.cursor + 1) % SMOKE_COUNT
      const p = particles[smokeStore.cursor]
      const src = smokeStore.cursor % 2 === 0 ? carChannel.rearLeft : carChannel.rearRight
      p.life = 0.0001
      p.maxLife = 1.6 + Math.random() * 1.0
      p.x = src.x + (Math.random() - 0.5) * 0.22
      p.y = 0.16 + Math.random() * 0.12
      p.z = src.z + (Math.random() - 0.5) * 0.22
      p.vx = ox * (0.9 + Math.random() * 1.1) + (Math.random() - 0.5) * 0.9
      p.vz = oz * (0.9 + Math.random() * 1.1) + (Math.random() - 0.5) * 0.9
      p.vy = 0.85 + Math.random() * 0.9
      p.size = 0.42 + Math.random() * 0.34
    }

    // integrate + write buffers
    for (let i = 0; i < SMOKE_COUNT; i++) {
      const p = particles[i]
      if (p.life > 0) {
        p.life += dt
        if (p.life >= p.maxLife) {
          p.life = 0
        } else {
          const drag = Math.exp(-1.7 * dt)
          p.vx *= drag
          p.vz *= drag
          p.vy = p.vy * Math.exp(-0.9 * dt) + 0.5 * dt
          p.x += p.vx * dt
          p.y += p.vy * dt
          p.z += p.vz * dt
        }
      }
      const t = p.life > 0 ? p.life / p.maxLife : 0
      position[i * 3] = p.x
      position[i * 3 + 1] = p.life > 0 ? p.y : -50
      position[i * 3 + 2] = p.z
      aSize[i] = p.size + t * 2.4
      aAlpha[i] = p.life > 0 ? Math.sin(Math.min(t, 1) * Math.PI) * 0.45 : 0
    }
    geometry.attributes.position.needsUpdate = true
    geometry.attributes.aSize.needsUpdate = true
    geometry.attributes.aAlpha.needsUpdate = true

    // point-size scale so smoke keeps its world size at any resolution
    const camera = state.camera as THREE.PerspectiveCamera
    const fov = (camera.fov * Math.PI) / 180
    materialRef.current.uniforms.uScale.value =
      state.gl.drawingBufferHeight * 0.5 / Math.tan(fov / 2)
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

/* ── Chase camera with pointer parallax ───────────────────────── */
function Rig() {
  const target = useMemo(() => new THREE.Vector3(), [])
  const lookAt = useMemo(() => new THREE.Vector3(), [])
  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.05)
    const t = state.clock.elapsedTime
    // Chase the car from its rear-3/4 quadrant (the hero angle) — the
    // bearing follows the car's yaw and slowly swings side to side for
    // variety, so the framing always flatters the drift.
    const bearing = carChannel.yaw + Math.PI + Math.sin(t * 0.06) * 0.7
    const distance = 8.6
    target.set(
      carChannel.center.x + Math.cos(bearing) * distance + state.pointer.x * 0.9,
      2.6 + state.pointer.y * 0.4,
      carChannel.center.z - Math.sin(bearing) * distance + state.pointer.y * 0.3
    )
    state.camera.position.lerp(target, 1 - Math.pow(0.002, dt))
    lookAt.set(carChannel.center.x * 0.85, 0.5, carChannel.center.z * 0.85)
    state.camera.lookAt(lookAt)
  })
  return null
}

/* ── Scene root ───────────────────────────────────────────────────── */
export default function BmwDriftScene() {
  return (
    <div className="absolute inset-0" aria-hidden="true">
      <Canvas
        dpr={[1, 1.75]}
        camera={{ position: [9.0, 2.0, -7.0], fov: 40, near: 0.1, far: 160 }}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      >
        <color attach="background" args={['#0d1017']} />
        <fogExp2 attach="fog" args={['#0d1017', 0.045]} />
        <ambientLight intensity={0.4} />
        <directionalLight position={[7, 11, 5]} intensity={1.45} color="#fff3e2" />
        <directionalLight position={[-9, 5, -7]} intensity={0.55} color="#a9bede" />
        <pointLight position={[0, 3.4, 0]} intensity={9} distance={9} color="#ffd9a8" />

        <DriftCar />
        <Smoke />
        <Ground />
        <ContactShadows
          position={[0, 0.015, 0]}
          opacity={0.72}
          scale={19}
          blur={2.6}
          far={4.5}
          resolution={512}
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
