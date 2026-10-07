/**
 * Location registry. Each environment is loaded only when selected so the
 * opening studio does not pay the JavaScript parse cost for every location.
 */

import type { SceneId } from '@/types/configurator'
import { makeCtx, type Ctx } from './shared'
import type { LocationScene } from './types'

export type { LocationLighting, LocationScene, LocationFrame } from './types'
export { STUDIO_LIGHTING } from './types'

export type BuildOptions = { mobile: boolean }

export async function buildLocationScene(id: SceneId, opts: BuildOptions): Promise<LocationScene | null> {
  const ctx: Ctx = makeCtx(opts.mobile)
  switch (id) {
    case 'nurburgring': {
      const { buildNurburgring } = await import('./nurburgring')
      return buildNurburgring(ctx)
    }
    case 'garage': {
      const { buildGarage } = await import('./garage')
      return buildGarage(ctx)
    }
    case 'alpine': {
      const { buildAlpine } = await import('./alpine')
      return buildAlpine(ctx)
    }
    case 'tokyo': {
      const { buildTokyo } = await import('./tokyo')
      return buildTokyo(ctx)
    }
    case 'dubai': {
      const { buildDubai } = await import('./dubai')
      return buildDubai(ctx)
    }
    case 'monaco': {
      const { buildMonaco } = await import('./monaco')
      return buildMonaco(ctx)
    }
    case 'docks': {
      const { buildDocks } = await import('./docks')
      return buildDocks(ctx)
    }
    default:
      return null
  }
}
