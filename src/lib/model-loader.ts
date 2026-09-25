'use client'

/**
 * Adaptive progressive model loader for slowest-internet optimization
 * 
 * Strategy:
 * - Detect connection speed via navigator.connection + save-data
 * - Pick smallest viable LOD for first paint (pico 3.6KB for slowest)
 * - Stream with real progress %
 * - Cache in CacheStorage + IndexedDB + ServiceWorker for instant reloads
 * - Progressive upgrade: pico -> nano -> ultra-low -> low -> mid -> high
 */

export type ModelTier = 'pico' | 'nano' | 'ultraLow' | 'lite' | 'mid' | 'high'
export type ConnectionSpeed = 'slow-2g' | '2g' | '3g' | '4g' | 'unknown'

export interface ModelVariant {
  tier: ModelTier
  url: string
  sizeKB: number
  tris: number
  description: string
}

export const MODEL_VARIANTS: Record<ModelTier, ModelVariant> = {
  pico: {
    tier: 'pico',
    url: '/models/bmw-m5-cs/scene-pico.glb', // 3.6KB, 72 tris, ultra-simple box
    sizeKB: 4,
    tris: 72,
    description: 'Pico for slowest internet - 3.6KB, loads in <1s on 2G',
  },
  nano: {
    tier: 'nano',
    url: '/models/bmw-m5-cs/scene-nano.glb', // 8.4KB, 200 tris
    sizeKB: 9,
    tris: 200,
    description: 'Nano for 2G - 8.4KB with lights',
  },
  ultraLow: {
    tier: 'ultraLow',
    url: '/models/bmw-m5-cs/scene-ultra-low.glb', // 260KB, ~20k tris, exterior only
    sizeKB: 260,
    tris: 20000,
    description: 'Ultra-lite for 3G slow',
  },
  lite: {
    tier: 'lite',
    url: '/models/bmw-m5-cs/scene-low.glb', // 270KB, ~21k tris
    sizeKB: 270,
    tris: 21156,
    description: 'Lite for 3G fast',
  },
  mid: {
    tier: 'mid',
    url: '/models/bmw-m5-cs/scene-mid.glb', // 1.1MB, ~112k tris, full interior
    sizeKB: 1110,
    tris: 111945,
    description: 'Mid quality for 4G',
  },
  high: {
    tier: 'high',
    url: '/models/bmw-m5-cs/scene.min.glb', // 3.1MB, ~306k tris, full quality
    sizeKB: 3188,
    tris: 305984,
    description: 'High quality for broadband',
  },
}

export function detectConnection(): { speed: ConnectionSpeed; saveData: boolean; rtt: number; downlink: number } {
  if (typeof navigator === 'undefined') {
    return { speed: 'unknown', saveData: false, rtt: 0, downlink: 0 }
  }
  const conn = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection
  if (!conn) {
    return { speed: 'unknown', saveData: false, rtt: 0, downlink: 0 }
  }
  const effectiveType = conn.effectiveType as ConnectionSpeed
  const saveData = !!conn.saveData
  const rtt = conn.rtt || 0
  const downlink = conn.downlink || 0
  return {
    speed: effectiveType || 'unknown',
    saveData,
    rtt,
    downlink,
  }
}

export function pickInitialTier(): ModelTier {
  const { speed, saveData, downlink, rtt } = detectConnection()
  
  // Respect Save-Data - always use smallest
  if (saveData) return 'pico'
  
  // RTT > 1000ms = very slow, use pico
  if (rtt > 1000) return 'pico'
  
  // Downlink is in Mbps - most reliable
  if (downlink > 0) {
    if (downlink < 0.3) return 'pico'   // < 300kbps = slow-2g
    if (downlink < 0.6) return 'nano'   // < 600kbps = 2g
    if (downlink < 1.5) return 'ultraLow' // < 1.5Mbps = 3g slow
    if (downlink < 3) return 'lite'     // < 3Mbps = 3g fast
    if (downlink < 8) return 'mid'      // < 8Mbps = 4g
    return 'high'
  }
  
  switch (speed) {
    case 'slow-2g':
      return 'pico'
    case '2g':
      return 'nano'
    case '3g':
      return 'ultraLow'
    case '4g':
      return 'mid'
    default:
      return 'mid'
  }
}

export function getUpgradePath(initial: ModelTier): ModelTier[] {
  const order: ModelTier[] = ['pico', 'nano', 'ultraLow', 'lite', 'mid', 'high']
  const idx = order.indexOf(initial)
  return order.slice(idx + 1)
}

/* ── IndexedDB cache for instant reloads ─────────────────────────────── */

const IDB_NAME = 'm5cs-model-cache-v3'
const IDB_STORE = 'models'
const IDB_VERSION = 3

function openIDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB not available'))
      return
    }
    const req = indexedDB.open(IDB_NAME, IDB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function getFromIDB(url: string): Promise<ArrayBuffer | null> {
  try {
    const db = await openIDB()
    return new Promise((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readonly')
      const store = tx.objectStore(IDB_STORE)
      const req = store.get(url)
      req.onsuccess = () => {
        const result = req.result as ArrayBuffer | undefined
        resolve(result || null)
      }
      req.onerror = () => resolve(null)
    })
  } catch {
    return null
  }
}

export async function saveToIDB(url: string, buffer: ArrayBuffer): Promise<void> {
  try {
    const db = await openIDB()
    const tx = db.transaction(IDB_STORE, 'readwrite')
    const store = tx.objectStore(IDB_STORE)
    store.put(buffer, url)
  } catch {
    // Silently fail - IDB is best-effort
  }
}

/* ── Streaming fetch with progress ───────────────────────────────────── */

export interface LoadProgress {
  loaded: number
  total: number
  percent: number
  tier: ModelTier
}

export async function fetchWithProgress(
  url: string,
  onProgress: (p: LoadProgress) => void,
  tier: ModelTier,
  signal?: AbortSignal
): Promise<ArrayBuffer> {
  // Try CacheStorage first (fastest)
  if (typeof window !== 'undefined' && 'caches' in window) {
    try {
      const cache = await caches.open('bmw-m5-cs-v3')
      const cached = await cache.match(url)
      if (cached) {
        const buf = await cached.arrayBuffer()
        onProgress({ loaded: buf.byteLength, total: buf.byteLength, percent: 100, tier })
        saveToIDB(url, buf)
        return buf
      }
    } catch {}
  }

  // Try IndexedDB second
  const idbBuf = await getFromIDB(url)
  if (idbBuf) {
    onProgress({ loaded: idbBuf.byteLength, total: idbBuf.byteLength, percent: 100, tier })
    if (typeof window !== 'undefined' && 'caches' in window) {
      caches.open('bmw-m5-cs-v3').then(cache => {
        const blob = new Blob([idbBuf])
        const res = new Response(blob, { headers: { 'Content-Length': String(idbBuf.byteLength) } })
        cache.put(url, res).catch(() => {})
      }).catch(() => {})
    }
    return idbBuf
  }

  // Network fetch with streaming
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  
  const contentLength = res.headers.get('Content-Length')
  const total = contentLength ? parseInt(contentLength, 10) : MODEL_VARIANTS[tier].sizeKB * 1024
  
  if (!res.body) {
    const buf = await res.arrayBuffer()
    onProgress({ loaded: buf.byteLength, total: buf.byteLength, percent: 100, tier })
    if (typeof window !== 'undefined' && 'caches' in window) {
      try {
        const cache = await caches.open('bmw-m5-cs-v3')
        cache.put(url, new Response(buf.slice(0), { headers: { 'Content-Length': String(buf.byteLength) } })).catch(() => {})
      } catch {}
    }
    saveToIDB(url, buf)
    return buf
  }

  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let loaded = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) {
      chunks.push(value)
      loaded += value.length
      const percent = total > 0 ? Math.min(99, (loaded / total) * 100) : 0
      onProgress({ loaded, total, percent, tier })
    }
  }

  const full = new Uint8Array(loaded)
  let offset = 0
  for (const chunk of chunks) {
    full.set(chunk, offset)
    offset += chunk.length
  }

  const buffer = full.buffer

  if (typeof window !== 'undefined' && 'caches' in window) {
    try {
      const cache = await caches.open('bmw-m5-cs-v3')
      const blob = new Blob([buffer])
      const cacheRes = new Response(blob, { headers: { 'Content-Length': String(buffer.byteLength) } })
      cache.put(url, cacheRes).catch(() => {})
    } catch {}
  }
  saveToIDB(url, buffer)

  onProgress({ loaded, total: loaded, percent: 100, tier })
  return buffer
}

/* ── Preload link hints ──────────────────────────── */

export function injectPreloadHints() {
  if (typeof document === 'undefined') return
  
  const initialTier = pickInitialTier()
  const variant = MODEL_VARIANTS[initialTier]
  
  const link = document.createElement('link')
  link.rel = 'preload'
  link.as = 'fetch'
  link.href = variant.url
  link.crossOrigin = 'anonymous'
  // @ts-ignore
  link.fetchPriority = 'high'
  document.head.appendChild(link)
  
  const upgrades = getUpgradePath(initialTier)
  if (upgrades.length > 0) {
    const nextVariant = MODEL_VARIANTS[upgrades[0]]
    const prefetchLink = document.createElement('link')
    prefetchLink.rel = 'prefetch'
    prefetchLink.as = 'fetch'
    prefetchLink.href = nextVariant.url
    prefetchLink.crossOrigin = 'anonymous'
    document.head.appendChild(prefetchLink)
  }
}
