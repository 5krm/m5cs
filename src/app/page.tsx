'use client'

import { useSyncExternalStore, useEffect, useState } from 'react'
import dynamic from 'next/dynamic'

// Dynamically import the heavy 3D experience with code splitting
// This ensures initial HTML/JS is tiny and paints instantly on slow internet
const ScrollExperience = dynamic(() => import('@/components/scroll-experience'), {
  ssr: false,
  loading: () => (
    <div className="flex min-h-screen w-full flex-col items-center justify-center bg-[#050608] text-[#e8ddc4]">
      <div className="flex flex-col items-center gap-6">
        <img src="/bmw-logo.svg" alt="" width={48} height={48} className="h-12 w-12 animate-pulse" />
        <div className="flex flex-col items-center gap-2">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-white" />
          <span className="text-[11px] uppercase tracking-[0.25em] text-white/50">Loading M5 CS Experience</span>
          <span className="text-[10px] font-mono text-white/30">Adaptive LOD • 260KB nano for slow internet</span>
        </div>
      </div>
    </div>
  ),
})

const emptySubscribe = () => () => {}

export default function Home() {
  const mounted = useSyncExternalStore(emptySubscribe, () => true, () => false)
  const [showExperience, setShowExperience] = useState(false)

  useEffect(() => {
    // Inject preload hints for adaptive model based on connection
    if (typeof window !== 'undefined' && 'navigator' in window) {
      const conn = (navigator as any).connection
      const saveData = conn?.saveData
      const effectiveType = conn?.effectiveType
      const downlink = conn?.downlink

      let tier = 'mid'
      if (saveData) tier = 'pico'
      else if (downlink) {
        if (downlink < 0.3) tier = 'pico'
        else if (downlink < 0.6) tier = 'nano'
        else if (downlink < 1.5) tier = 'ultraLow'
        else if (downlink < 3) tier = 'lite'
        else if (downlink < 8) tier = 'mid'
        else tier = 'high'
      } else {
        switch (effectiveType) {
          case 'slow-2g':
            tier = 'pico'
            break
          case '2g':
            tier = 'nano'
            break
          case '3g':
            tier = 'ultraLow'
            break
          case '4g':
            tier = 'mid'
            break
          default:
            tier = 'mid'
        }
      }

      const urls: Record<string, string> = {
        pico: '/models/bmw-m5-cs/scene-pico.glb',
        nano: '/models/bmw-m5-cs/scene-nano.glb',
        ultraLow: '/models/bmw-m5-cs/scene-ultra-low.glb',
        lite: '/models/bmw-m5-cs/scene-low.glb',
        mid: '/models/bmw-m5-cs/scene-mid.glb',
        high: '/models/bmw-m5-cs/scene.min.glb',
      }

      // Preload the chosen tier with high priority
      const link = document.createElement('link')
      link.rel = 'preload'
      link.as = 'fetch'
      link.href = urls[tier]
      link.crossOrigin = 'anonymous'
      // @ts-ignore
      link.fetchPriority = 'high'
      document.head.appendChild(link)

      // Prefetch next tier
      const order = ['pico', 'nano', 'ultraLow', 'lite', 'mid', 'high']
      const idx = order.indexOf(tier)
      if (idx >= 0 && idx < order.length - 1) {
        const nextTier = order[idx + 1]
        const prefetch = document.createElement('link')
        prefetch.rel = 'prefetch'
        prefetch.as = 'fetch'
        prefetch.href = urls[nextTier]
        prefetch.crossOrigin = 'anonymous'
        document.head.appendChild(prefetch)
      }

      // Warm up CacheStorage in background
      if ('caches' in window) {
        caches.open('bmw-m5-cs-v2').then(cache => {
          // Only warm if not already cached
          cache.match(urls[tier]).then(match => {
            if (!match) {
              // Don't actually fetch here, just prepare cache - fetch happens in component
            }
          })
        }).catch(() => {})
      }
    }

    // Small delay to let initial paint happen before heavy 3D JS loads
    // This makes the site feel instant on slow internet
    const timer = setTimeout(() => setShowExperience(true), 50)
    return () => clearTimeout(timer)
  }, [])

  if (!mounted || !showExperience) {
    return (
      <div className="flex min-h-screen w-full flex-col items-center justify-center bg-[#050608] text-[#e8ddc4]">
        <div className="flex flex-col items-center gap-6">
          <img src="/bmw-logo.svg" alt="" width={48} height={48} className="h-12 w-12 animate-pulse" />
          <div className="flex flex-col items-center gap-3">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-white" />
            <span className="text-[11px] uppercase tracking-[0.25em] text-white/50">Loading M5 CS Experience</span>
            <span className="text-[10px] font-mono text-white/30">Adaptive LOD • 260KB nano for slow internet • 0KB placeholder instant</span>
          </div>
          <div className="w-[200px] h-[1px] bg-white/10 overflow-hidden rounded-full">
            <div className="h-full w-1/2 bg-gradient-to-r from-[#FFB733] to-[#E4002B] animate-pulse" />
          </div>
        </div>
      </div>
    )
  }

  return <ScrollExperience />
}
