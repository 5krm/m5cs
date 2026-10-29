import type { SceneId } from '@/types/configurator'
import type { LocationScene } from './types'
export type { LocationLighting, LocationScene, LocationFrame } from './types'
export { STUDIO_LIGHTING } from './types'
export type BuildOptions = { mobile: boolean }
export async function buildLocationScene(id: SceneId, opts: BuildOptions): Promise<LocationScene | null> {
  if (id === 'studio') return null
  const { buildPhotographicLocation } = await import('./photographic')
  return buildPhotographicLocation(id, opts.mobile)
}
