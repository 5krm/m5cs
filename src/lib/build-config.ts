import type {
  CaliperColor,
  PaintFinish,
  SceneId,
  StudioTheme,
  WheelFinish,
} from '@/types/configurator'

/** A shareable, locally saved M5 CS build. */
export interface BuildConfiguration {
  paint: PaintFinish
  wheelFinish: WheelFinish
  caliperColor: CaliperColor
  sceneId: SceneId
  theme: StudioTheme
  highBeams: boolean
}

export const BUILD_STORAGE_KEY = 'm5cs_build_v2'

export const DEFAULT_BUILD_CONFIGURATION: BuildConfiguration = {
  paint: 'brands-hatch-grey',
  wheelFinish: 'gold-bronze',
  caliperColor: 'red',
  sceneId: 'studio',
  theme: 'apex',
  highBeams: true,
}

const PAINT_FINISHES = [
  'frozen-deep-green',
  'brands-hatch-grey',
  'frozen-bluestone',
  'sapphire-black',
] satisfies readonly PaintFinish[]

const WHEEL_FINISHES = [
  'gold-bronze',
  'jet-black',
  'orbit-grey',
  'brilliant-silver',
] satisfies readonly WheelFinish[]

const CALIPER_COLORS = ['gold', 'red', 'blue', 'yellow'] satisfies readonly CaliperColor[]
const SCENE_IDS = ['studio', 'nurburgring', 'garage', 'alpine', 'tokyo', 'dubai', 'monaco', 'docks'] satisfies readonly SceneId[]
const STUDIO_THEMES = ['apex', 'm', 'night'] satisfies readonly StudioTheme[]
const QUERY_KEYS = ['paint', 'wheels', 'calipers', 'scene', 'theme', 'beams'] as const

function choose<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  return typeof value === 'string' && options.includes(value as T) ? (value as T) : fallback
}

/** Validate untrusted URL/storage values before they can reach the renderer. */
export function normalizeBuildConfiguration(value: unknown): BuildConfiguration {
  const candidate = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  return {
    paint: choose(candidate.paint, PAINT_FINISHES, DEFAULT_BUILD_CONFIGURATION.paint),
    wheelFinish: choose(candidate.wheelFinish, WHEEL_FINISHES, DEFAULT_BUILD_CONFIGURATION.wheelFinish),
    caliperColor: choose(candidate.caliperColor, CALIPER_COLORS, DEFAULT_BUILD_CONFIGURATION.caliperColor),
    sceneId: choose(candidate.sceneId, SCENE_IDS, DEFAULT_BUILD_CONFIGURATION.sceneId),
    theme: choose(candidate.theme, STUDIO_THEMES, DEFAULT_BUILD_CONFIGURATION.theme),
    highBeams:
      typeof candidate.highBeams === 'boolean'
        ? candidate.highBeams
        : DEFAULT_BUILD_CONFIGURATION.highBeams,
  }
}

/**
 * Query values take precedence over a saved build so shared links always open
 * exactly as sent. Without build query values, restore the last local build.
 */
export function readBuildConfiguration(search: string, savedJson: string | null): BuildConfiguration {
  const params = new URLSearchParams(search)
  const hasBuildQuery = QUERY_KEYS.some((key) => params.has(key))

  if (hasBuildQuery) {
    return normalizeBuildConfiguration({
      paint: params.get('paint'),
      wheelFinish: params.get('wheels'),
      caliperColor: params.get('calipers'),
      sceneId: params.get('scene'),
      theme: params.get('theme'),
      highBeams: params.has('beams') ? params.get('beams') === '1' : undefined,
    })
  }

  if (savedJson) {
    try {
      const parsed: unknown = JSON.parse(savedJson)
      return normalizeBuildConfiguration(parsed)
    } catch {
      // Ignore stale or corrupted storage and use a fresh baseline.
    }
  }

  return { ...DEFAULT_BUILD_CONFIGURATION }
}

/** Stable, compact URL representation for a build someone can share. */
export function serializeBuildConfiguration(value: BuildConfiguration): string {
  const build = normalizeBuildConfiguration(value)
  const params = new URLSearchParams()
  params.set('paint', build.paint)
  params.set('wheels', build.wheelFinish)
  params.set('calipers', build.caliperColor)
  params.set('scene', build.sceneId)
  params.set('theme', build.theme)
  params.set('beams', build.highBeams ? '1' : '0')
  return params.toString()
}

/** Browser-only adapter; safe to call from a client-component initializer. */
export function getInitialBuildConfiguration(): BuildConfiguration {
  if (typeof window === 'undefined') return { ...DEFAULT_BUILD_CONFIGURATION }

  try {
    return readBuildConfiguration(
      window.location.search,
      window.localStorage.getItem(BUILD_STORAGE_KEY),
    )
  } catch {
    return readBuildConfiguration(window.location.search, null)
  }
}
