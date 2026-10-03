/**
 * WebGL capability probe.
 *
 * `new THREE.WebGLRenderer()` THROWS when the browser cannot hand out a WebGL
 * context (hardware acceleration off, blocklisted GPU/driver, software
 * rasterizer disabled, too many live contexts, some headless/embedded
 * webviews). That throw used to escape the init `useEffect` in
 * <ScrollExperience>, which makes React tear down the whole root — the page
 * went blank and the "Loading M5 CS Experience" fallback never resolved.
 *
 * Probing first lets us render a real fallback instead of crashing.
 */
export function detectWebGL(): { ok: true } | { ok: false; reason: string } {
  if (typeof window === 'undefined') return { ok: false, reason: 'No browser environment.' }

  if (typeof WebGLRenderingContext === 'undefined') {
    return { ok: false, reason: 'This browser does not support WebGL.' }
  }

  let canvas: HTMLCanvasElement | null = null
  try {
    canvas = document.createElement('canvas')
    const attrs: WebGLContextAttributes = {
      failIfMajorPerformanceCaveat: false,
      powerPreference: 'high-performance',
    }
    const gl =
      canvas.getContext('webgl2', attrs) ||
      canvas.getContext('webgl', attrs) ||
      canvas.getContext('experimental-webgl', attrs)

    if (!gl) {
      return {
        ok: false,
        reason:
          'WebGL is unavailable. This is usually hardware acceleration being turned off in your browser settings.',
      }
    }

    // Release the probe context immediately — browsers cap the number of live
    // contexts (~16), and the real renderer needs one of those slots.
    const lose = (gl as WebGLRenderingContext).getExtension('WEBGL_lose_context')
    lose?.loseContext()

    return { ok: true }
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : 'WebGL could not be initialised.' }
  } finally {
    if (canvas) {
      canvas.width = 0
      canvas.height = 0
    }
  }
}
