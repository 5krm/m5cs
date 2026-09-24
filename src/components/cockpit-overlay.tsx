'use client'

/**
 * Cockpit HUD — shown while the camera sits in the driver's seat.
 *
 *   • Exit button + drag hint
 *   • Anchored call-outs (steering wheel, bucket seat)
 *
 * The 3D side (hiding the shell, look-around drag) lives in
 * scroll-experience.tsx; this file is DOM-only.
 */

import React from 'react'
import type { CockpitCallout } from '@/types/configurator'

interface CockpitOverlayProps {
  active: boolean
  onExit: () => void
  callouts: CockpitCallout[]
}

export default function CockpitOverlay({ active, onExit, callouts }: CockpitOverlayProps) {
  return (
    <div
      aria-hidden={!active}
      className={`pointer-events-none fixed inset-0 z-20 transition-opacity duration-500 ${
        active ? 'opacity-100' : 'opacity-0'
      }`}
    >
      {/* subtle vignette so the HUD reads over the bright dash */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_55%,rgba(0,0,0,0.55)_100%)]" />

      {/* ── Top-left: exit ── */}
      <div className="absolute left-[clamp(16px,4vw,48px)] top-[84px] flex flex-col gap-3">
        <p className="m-0 text-[10px] font-semibold uppercase tracking-[0.32em] text-white/70">Cockpit</p>
        <h2 className="m-0 text-[clamp(20px,3vw,30px)] font-semibold tracking-[-0.01em] text-[#f7f4ec] [text-shadow:0_1px_14px_rgba(0,0,0,0.6)]">
          Driver&apos;s seat
        </h2>
        <p className="m-0 max-w-[280px] text-[12px] leading-relaxed text-white/60">Drag to look around.</p>
        <button
          type="button"
          onClick={onExit}
          className={`mt-1 w-fit rounded-full border border-white/25 bg-black/40 px-4 py-1.5 text-[12px] font-medium text-white backdrop-blur-md transition-all hover:bg-white/15 active:scale-95 ${
            active ? 'pointer-events-auto' : ''
          }`}
        >
          ← Get out
        </button>
      </div>

      {/* ── 3D-anchored callouts (positions written by the render loop) ── */}
      {callouts.map((c) => (
        <div
          key={c.id}
          id={`cockpit-callout-${c.id}`}
          className="absolute left-0 top-0 will-change-transform"
          style={{ opacity: 0, transform: 'translate3d(-9999px,-9999px,0)' }}
        >
          <div className="relative -translate-x-1/2 -translate-y-1/2">
            <span className="block h-2.5 w-2.5 rounded-full border border-white/80 bg-white/30 shadow-[0_0_10px_rgba(255,255,255,0.7)]" />
            <span className="absolute left-1/2 top-1/2 h-px w-8 -translate-y-1/2 bg-white/50" />
            <div className="absolute left-9 top-1/2 w-[190px] -translate-y-1/2 rounded-lg border border-white/15 bg-[#080a0f]/80 px-3 py-2 backdrop-blur-md">
              <p className="m-0 text-[11px] font-semibold text-white">{c.label}</p>
              <p className="m-0 mt-0.5 text-[10px] leading-snug text-white/55">{c.sublabel}</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
