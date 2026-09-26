/**
 * Shared contract between the showroom (scroll-experience) and the locations.
 */

import type * as THREE from 'three'
import type { SceneId } from '@/types/configurator'

export type LocationLighting = {
  key: { color: number; intensity: number; position: [number, number, number] }
  rim: { color: number; intensity: number; position: [number, number, number] }
  hemi: { sky: number; ground: number; intensity: number }
  fog: { color: number; density: number }
  exposure: number
  environmentIntensity: number
  /** multiplier for the head/tail-light floor projections (daylight ≈ 0) */
  beamScale: number
  /** does this floor let the mirrored car double show through? */
  floorReflection: boolean
  /**
   * Optional shadow-rig tuning. Outdoor locations need a wider, longer shadow
   * frustum than the studio's 6 m cove; without this the pit buildings and
   * trees simply stop casting.
   */
  shadow?: {
    angle?: number
    penumbra?: number
    near?: number
    far?: number
    mapSize?: number
    focus?: [number, number, number]
  }
}

/** Everything a location needs to animate one frame. */
export type LocationFrame = {
  /** elapsed seconds since the experience started */
  time: number
  /** clamped delta seconds since the previous frame */
  dt: number
  camera: THREE.PerspectiveCamera
  /** scroll progress 0..1 — lets a location choreograph with the page */
  scroll: number
}

export type LocationScene = {
  id: SceneId
  group: THREE.Group
  background: THREE.Texture | THREE.Color
  lighting: LocationLighting
  /**
   * Equirectangular sky texture. When present the showroom PMREM-bakes it into
   * `scene.environment`, so paint, glass and water reflect the sky they are
   * actually parked under instead of the neutral studio probe.
   */
  environment?: THREE.Texture | null
  update?: (frame: LocationFrame) => void
  dispose: () => void
  /** small facts surfaced in the configurator dock */
  facts?: Array<{ label: string; value: string }>
}

/** The verified studio baseline — re-applied when returning to the studio. */
export const STUDIO_LIGHTING: LocationLighting = {
  key: { color: 0xfff1dd, intensity: 380, position: [7, 9, 5] },
  rim: { color: 0xbfd0e8, intensity: 1.6, position: [-8, 5, -6] },
  hemi: { sky: 0x39404e, ground: 0x0b0c10, intensity: 0.42 },
  fog: { color: 0x050608, density: 0.018 },
  exposure: 1.0,
  environmentIntensity: 1.0,
  beamScale: 1.0,
  floorReflection: true,
}
