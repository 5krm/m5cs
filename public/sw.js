/**
 * Service Worker for BMW M5 CS - Optimized for slowest internet
 * 
 * Strategy:
 * - Cache-first for models (immutable, versioned)
 * - Stale-while-revalidate for HTML/JS/CSS
 * - Network-first for API
 * - Instant reloads from cache on repeat visits
 */

const CACHE_VERSION = 'm5cs-v2-optimized'
const MODEL_CACHE = `${CACHE_VERSION}-models`
const STATIC_CACHE = `${CACHE_VERSION}-static`
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`

// Models to precache based on connection (we'll cache adaptively)
const MODEL_URLS = [
  '/models/bmw-m5-cs/scene-ultra-low.glb', // 260KB nano - critical for slow internet
  '/models/bmw-m5-cs/scene-low.glb',       // 270KB lite
  '/models/bmw-m5-cs/manifest.json',
]

const STATIC_ASSETS = [
  '/bmw-logo.svg',
  '/bmw-roundel.png',
  '/logo.svg',
]

self.addEventListener('install', (event) => {
  console.log('[SW] Install', CACHE_VERSION)
  // Skip waiting so new SW activates immediately
  self.skipWaiting()
  
  event.waitUntil(
    (async () => {
      // Precache critical small assets only - not heavy models (those are cached on demand)
      // For slowest internet, we don't want to auto-download 3MB on install
      const staticCache = await caches.open(STATIC_CACHE)
      try {
        await staticCache.addAll(STATIC_ASSETS)
      } catch (e) {
        console.warn('[SW] Failed to precache static:', e)
      }
      
      // Only precache nano model if connection is decent or save-data is off
      // Check via client hints if available
      try {
        const modelCache = await caches.open(MODEL_CACHE)
        // Don't auto-precache models on install for slow internet - cache on demand
        // But we can try to cache manifest
        await modelCache.add('/models/bmw-m5-cs/manifest.json').catch(() => {})
      } catch (e) {
        console.warn('[SW] Failed to precache manifest:', e)
      }
    })()
  )
})

self.addEventListener('activate', (event) => {
  console.log('[SW] Activate', CACHE_VERSION)
  event.waitUntil(
    (async () => {
      // Clean old caches
      const keys = await caches.keys()
      for (const key of keys) {
        if (key !== MODEL_CACHE && key !== STATIC_CACHE && key !== RUNTIME_CACHE && key.startsWith('m5cs-')) {
          console.log('[SW] Deleting old cache:', key)
          await caches.delete(key)
        }
      }
      // Claim clients immediately
      await self.clients.claim()
    })()
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)
  
  // Only handle same-origin requests
  if (url.origin !== location.origin) return
  
  // Model files - Cache First, with background revalidation
  // These are immutable and versioned, so cache-first is safe and fastest for slow internet
  if (url.pathname.startsWith('/models/')) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(MODEL_CACHE)
        const cached = await cache.match(request)
        if (cached) {
          // Return cached immediately, update in background (stale-while-revalidate)
          event.waitUntil(
            (async () => {
              try {
                const networkRes = await fetch(request)
                if (networkRes.ok) {
                  await cache.put(request, networkRes.clone())
                }
              } catch {}
            })()
          )
          return cached
        }
        
        // Not cached - fetch from network and cache
        try {
          const networkRes = await fetch(request)
          if (networkRes.ok) {
            // Cache for next time
            cache.put(request, networkRes.clone()).catch(() => {})
          }
          return networkRes
        } catch (e) {
          // Network failed and not cached - return 503
          return new Response('Model not available offline', { status: 503, statusText: 'Service Unavailable' })
        }
      })()
    )
    return
  }
  
  // Static assets - Cache First
  if (
    url.pathname.endsWith('.svg') ||
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.jpg') ||
    url.pathname.endsWith('.webp') ||
    url.pathname.endsWith('.woff2')
  ) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(STATIC_CACHE)
        const cached = await cache.match(request)
        if (cached) return cached
        
        try {
          const networkRes = await fetch(request)
          if (networkRes.ok) {
            cache.put(request, networkRes.clone()).catch(() => {})
          }
          return networkRes
        } catch {
          return cached || new Response('Not found', { status: 404 })
        }
      })()
    )
    return
  }
  
  // JS/CSS - Stale While Revalidate
  if (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.css')
  ) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(RUNTIME_CACHE)
        const cached = await cache.match(request)
        
        const networkFetch = fetch(request)
          .then((networkRes) => {
            if (networkRes.ok) {
              cache.put(request, networkRes.clone()).catch(() => {})
            }
            return networkRes
          })
          .catch(() => cached)
        
        // Return cached immediately if available, otherwise wait for network
        return cached || (await networkFetch)
      })()
    )
    return
  }
  
  // HTML - Network First, fallback to cache
  if (request.headers.get('Accept')?.includes('text/html')) {
    event.respondWith(
      (async () => {
        try {
          const networkRes = await fetch(request)
          if (networkRes.ok) {
            const cache = await caches.open(RUNTIME_CACHE)
            cache.put(request, networkRes.clone()).catch(() => {})
          }
          return networkRes
        } catch {
          const cache = await caches.open(RUNTIME_CACHE)
          const cached = await cache.match(request)
          return cached || new Response('Offline', { status: 503 })
        }
      })()
    )
    return
  }
  
  // Default - Network with cache fallback
  event.respondWith(
    (async () => {
      try {
        return await fetch(request)
      } catch {
        const cache = await caches.open(RUNTIME_CACHE)
        const cached = await cache.match(request)
        return cached || new Response('Offline', { status: 503 })
      }
    })()
  )
})

// Handle messages from client for cache management
self.addEventListener('message', (event) => {
  if (event.data?.type === 'CACHE_MODEL') {
    const url = event.data.url
    if (url && url.startsWith('/models/')) {
      event.waitUntil(
        (async () => {
          const cache = await caches.open(MODEL_CACHE)
          try {
            const res = await fetch(url)
            if (res.ok) await cache.put(url, res)
          } catch {}
        })()
      )
    }
  }
  
  if (event.data?.type === 'CLEAR_CACHE') {
    event.waitUntil(
      (async () => {
        const keys = await caches.keys()
        for (const key of keys) {
          if (key.startsWith('m5cs-')) await caches.delete(key)
        }
      })()
    )
  }
})
