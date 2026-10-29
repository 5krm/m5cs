import * as THREE from 'three'
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js'
import { GroundedSkybox } from 'three/examples/jsm/objects/GroundedSkybox.js'
import type { SceneId } from '@/types/configurator'
import type { LocationScene } from './types'

export const PHOTO_LOCATIONS = {
  alpine: { file: 'mountain-road', source: 'orbita', height: 8, exposure: 0.9 },
  garage: { file: 'city-parking', source: 'mall_parking_lot', height: 8, exposure: 0.85 },
  monaco: { file: 'sunset-avenue', source: 'suburban_parking_area', height: 8, exposure: 0.95 },
} as const
export type PhotoLocationId = keyof typeof PHOTO_LOCATIONS
export const PHOTO_IDS = Object.keys(PHOTO_LOCATIONS) as PhotoLocationId[]
export function randomLocation(current?: SceneId): PhotoLocationId {
  const choices = PHOTO_IDS.filter(id => id !== current)
  return choices[Math.floor(Math.random() * choices.length)]
}
export async function buildPhotographicLocation(id: Exclude<SceneId, 'studio'>, mobile: boolean): Promise<LocationScene> {
  // Preserve old shared links while retiring the geometric environments.
  const photoId: PhotoLocationId = id in PHOTO_LOCATIONS ? id as PhotoLocationId : 'alpine'
  const photo = PHOTO_LOCATIONS[photoId]
  const environment = await new HDRLoader().loadAsync(`/environments/${photo.file}.hdr`)
  environment.mapping = THREE.EquirectangularReflectionMapping
  const group = new THREE.Group()
  const skybox = new GroundedSkybox(environment, photo.height, 120, mobile ? 32 : 48)
  skybox.position.y = photo.height - 0.02
  skybox.renderOrder = -1
  group.add(skybox)
  // Transparent shadow catcher preserves the photographed pavement.
  const geometry = new THREE.PlaneGeometry(25, 25)
  const material = new THREE.ShadowMaterial({ opacity: 0.3, depthWrite: false })
  const floor = new THREE.Mesh(geometry, material)
  floor.rotation.x = -Math.PI / 2; floor.position.y = 0.005; floor.receiveShadow = true
  group.add(floor)
  return {
    id, group, background: environment, environment,
    lighting: {
      key: { color: 0xfff2df, intensity: 160, position: [7, 10, 5] },
      rim: { color: 0xc8d9ed, intensity: 0.45, position: [-8, 5, -6] },
      hemi: { sky: 0xcbd8e3, ground: 0x42403c, intensity: 0.25 },
      fog: { color: 0xa7b4be, density: 0 }, exposure: photo.exposure,
      environmentIntensity: 1, beamScale: 0, floorReflection: false,
      shadow: { near: 1, far: 40, angle: 0.75, penumbra: 0.8 },
    },
    dispose() {
      environment.dispose(); skybox.geometry.dispose(); skybox.material.dispose()
      geometry.dispose(); material.dispose()
    },
  }
}
