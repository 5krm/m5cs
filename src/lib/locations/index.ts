/**
 * ═════════════════════════════════════════════════════════════════════════
 * locations — registry
 * ═════════════════════════════════════════════════════════════════════════
 * Seven hand-built environments for the M5 CS to be parked in. Each one is
 * fully procedural (no image downloads) and each one ships its own lighting,
 * fog, sky, ambience and animation logic.
 */

import type { SceneId } from '@/types/configurator'
import { makeCtx, type Ctx } from './shared'
import type { LocationScene } from './types'
import { buildNurburgring } from './nurburgring'
import { buildGarage } from './garage'
import { buildAlpine } from './alpine'
import { buildTokyo } from './tokyo'
import { buildDubai } from './dubai'
import { buildMonaco } from './monaco'
import { buildDocks } from './docks'

export type { LocationLighting, LocationScene, LocationFrame } from './types'
export { STUDIO_LIGHTING } from './types'

export type BuildOptions = { mobile: boolean }

export function buildLocationScene(id: SceneId, opts: BuildOptions): LocationScene | null {
  const ctx: Ctx = makeCtx(opts.mobile)
  switch (id) {
    case 'nurburgring':
      return buildNurburgring(ctx)
    case 'garage':
      return buildGarage(ctx)
    case 'alpine':
      return buildAlpine(ctx)
    case 'tokyo':
      return buildTokyo(ctx)
    case 'dubai':
      return buildDubai(ctx)
    case 'monaco':
      return buildMonaco(ctx)
    case 'docks':
      return buildDocks(ctx)
    default:
      return null
  }
}
