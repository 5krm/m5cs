'use client'

/**
 * Cockpit HUD — shown while the camera sits in the driver's seat.
 *
 *   • M1 / M2 setup buttons (M1 = red cluster, M2 = orange, road = cool blue)
 *   • Live tachometer needle fed from the synthesised V8 (v8Audio.rpm)
 *   • Three anchored call-outs (steering wheel, bucket seat, M buttons)
 *   • Drag hint + exit button
 *
 * The 3D side (hiding the shell, tinting the cluster, look-around drag)
 * lives in scroll-experience.tsx; this file is DOM-only.
 */

import React from 'react'
import type { CockpitCallout, MMode } from '@/types/configurator'
import { v8Audio } from '@/lib/engine-audio'

interface CockpitOverlayProps {
  active: boolean
  mode: MMode
  onModeChange: (m: MMode) => void
  onExit: () => void
  rpm: number
  callouts: CockpitCallout[]
}

const MODE_META: Record<MMode, { label: string; color: string; desc: string }> = {
  road: { label: 'ROAD', color: '#9fd0ff', desc: 'Comfort damping · 4WD · Efficient' },
  m1: { label: 'M1', color: '#ff2a2a', desc: 'Sport Plus · 4WD Sport · MDM on' },
  m2: { label: 'M2', color: '#ff6a00', desc: 'Track · 2WD · DSC off · Nürburgring map' },
}

const REDLINE = 7200
const RPM_START = -135 // needle angle at 0 rpm (deg)
const RPM_END = 135 // needle angle at 8 000 rpm (deg)

export default function CockpitOverlay({ active, mode, onModeChange, onExit, rpm, callouts }: CockpitOverlayProps) {
  const meta = MODE_META[mode]
  const rpmNorm = Math.min(1, rpm / 8000)
  const needle = RPM_START + (RPM_END - RPM_START) * rpmNorm
  const engineOn = rpm > 0

  return (
    <div
      aria-hidden={!active}
      className={`pointer-events-none fixed inset-0 z-20 transition-opacity duration-500 ${
        active ? 'opacity-100' : 'opacity-0'
      }`}
    >
      {/* subtle vignette so the HUD reads over the bright dash */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_55%,rgba(0,0,0,0.55)_100%)]" />

      {/* ── Top-left: mode chip + exit ── */}
      <div className="absolute left-[clamp(16px,4vw,48px)] top-[84px] flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: meta.color, boxShadow: `0 0 12px ${meta.color}` }}
          />
          <p className="m-0 text-[10px] font-semibold uppercase tracking-[0.32em] text-white/70">Cockpit · {meta.label}</p>
        </div>
        <h2 className="m-0 text-[clamp(20px,3vw,30px)] font-semibold tracking-[-0.01em] text-[#f7f4ec] [text-shadow:0_1px_14px_rgba(0,0,0,0.6)]">
          Driver&apos;s seat
        </h2>
        <p className="m-0 max-w-[280px] text-[12px] leading-relaxed text-white/60">
          Drag to look around. {meta.desc}.
        </p>
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

      {/* ── Bottom-left: M setup buttons ── */}
      <div
        className={`absolute bottom-[104px] left-[clamp(16px,4vw,48px)] flex items-center gap-2 rounded-2xl border border-white/15 bg-[#080a0f]/85 p-2 backdrop-blur-xl ${
          active ? 'pointer-events-auto' : ''
        }`}
        role="radiogroup"
        aria-label="M setup"
      >
        {(['road', 'm1', 'm2'] as MMode[]).map((m) => {
          const sel = m === mode
          const c = MODE_META[m].color
          return (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={sel}
              onClick={() => onModeChange(m)}
              className="relative flex h-11 min-w-[56px] items-center justify-center rounded-xl border text-[13px] font-black italic tracking-wider transition-all active:scale-95"
              style={{
                borderColor: sel ? c : 'rgba(255,255,255,0.12)',
                background: sel ? `${c}22` : 'rgba(255,255,255,0.04)',
                color: sel ? c : 'rgba(255,255,255,0.6)',
                boxShadow: sel ? `0 0 18px ${c}55, inset 0 0 12px ${c}22` : 'none',
              }}
            >
              {MODE_META[m].label}
            </button>
          )
        })}
        <div className="mx-1 h-6 w-px bg-white/15" />
        <button
          type="button"
          onClick={() => {
            if (!v8Audio.running) v8Audio.start()
            v8Audio.rev()
          }}
          className="flex h-11 items-center gap-1.5 rounded-xl border border-white/12 bg-white/5 px-3 text-[12px] font-medium text-white transition-all hover:bg-white/15 active:scale-95"
          title="Blip the throttle"
        >
          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: engineOn ? meta.color : 'rgba(255,255,255,0.4)' }} />
          Rev
        </button>
      </div>

      {/* ── Bottom-right: tachometer ── */}
      <div className="absolute bottom-[100px] right-[clamp(16px,4vw,48px)]">
        <svg width="168" height="168" viewBox="-100 -100 200 200" aria-label={`Tachometer ${Math.round(rpm)} rpm`}>
          <defs>
            <linearGradient id="tachoArc" x1="0" x2="1">
              <stop offset="0" stopColor="rgba(255,255,255,0.28)" />
              <stop offset="1" stopColor={meta.color} />
            </linearGradient>
          </defs>
          <circle r="92" fill="rgba(6,8,12,0.78)" stroke="rgba(255,255,255,0.1)" />
          {/* dial ticks — every 1 000 rpm, redline from 7 200 */}
          {Array.from({ length: 9 }).map((_, i) => {
            const a = ((RPM_START + ((RPM_END - RPM_START) * i) / 8) * Math.PI) / 180
            const red = i * 1000 >= REDLINE
            const x1 = Math.sin(a) * 70
            const y1 = -Math.cos(a) * 70
            const x2 = Math.sin(a) * 82
            const y2 = -Math.cos(a) * 82
            const lx = Math.sin(a) * 56
            const ly = -Math.cos(a) * 56
            return (
              <g key={i}>
                <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={red ? '#ff2a2a' : 'rgba(255,255,255,0.7)'} strokeWidth={red ? 4 : 2.5} />
                <text x={lx} y={ly + 4} textAnchor="middle" fontSize="12" fontWeight="600" fill={red ? '#ff2a2a' : 'rgba(255,255,255,0.75)'}>
                  {i}
                </text>
              </g>
            )
          })}
          {/* redline arc */}
          <path
            d={describeArc(0, 0, 86, RPM_START + (RPM_END - RPM_START) * (REDLINE / 8000), RPM_END)}
            fill="none"
            stroke="#ff2a2a"
            strokeWidth="5"
            opacity="0.85"
          />
          {/* live arc */}
          <path
            d={describeArc(0, 0, 86, RPM_START, Math.max(RPM_START + 0.01, needle))}
            fill="none"
            stroke="url(#tachoArc)"
            strokeWidth="5"
            strokeLinecap="round"
          />
          {/* needle */}
          <g style={{ transform: `rotate(${needle}deg)`, transition: 'transform 80ms linear' }}>
            <line x1="0" y1="10" x2="0" y2="-74" stroke={meta.color} strokeWidth="3" strokeLinecap="round" />
            <line x1="0" y1="10" x2="0" y2="-74" stroke="#fff" strokeWidth="1" strokeLinecap="round" opacity="0.6" />
          </g>
          <circle r="6" fill="#0b0d12" stroke={meta.color} strokeWidth="2" />
          <text y="38" textAnchor="middle" fontSize="18" fontWeight="700" fill="#fff" fontFamily="ui-monospace, monospace">
            {engineOn ? Math.round(rpm).toLocaleString('en-US') : '— —'}
          </text>
          <text y="54" textAnchor="middle" fontSize="9" letterSpacing="3" fill="rgba(255,255,255,0.5)">
            RPM
          </text>
          <text y="-44" textAnchor="middle" fontSize="10" fontWeight="800" fontStyle="italic" fill={meta.color} letterSpacing="2">
            {meta.label}
          </text>
        </svg>
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

/** SVG arc path helper (angles in degrees, 0 = 12 o'clock, clockwise) */
function describeArc(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  const toXY = (deg: number) => {
    const a = (deg * Math.PI) / 180
    return [cx + Math.sin(a) * r, cy - Math.cos(a) * r] as const
  }
  const [sx, sy] = toXY(startDeg)
  const [ex, ey] = toXY(endDeg)
  const large = endDeg - startDeg > 180 ? 1 : 0
  return `M ${sx.toFixed(2)} ${sy.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${ex.toFixed(2)} ${ey.toFixed(2)}`
}
