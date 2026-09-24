'use client'

import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import {
  StudioTheme,
  PaintFinish,
  SceneId,
  PAINT_CONFIGS,
  SCENES,
} from '@/types/configurator'

interface ConfiguratorDockProps {
  theme: StudioTheme
  onThemeChange: (t: StudioTheme) => void
  highBeams: boolean
  onToggleHighBeams: () => void
  paint: PaintFinish
  onPaintChange: (p: PaintFinish) => void
  orbitMode: boolean
  onToggleOrbit: () => void
  sceneId: SceneId
  onSceneChange: (id: SceneId) => void
  cockpitMode: boolean
  onToggleCockpit: () => void
  showText?: boolean
  onToggleText?: () => void
}

type Tab = 'paint' | 'studio' | 'scene'

export default function ConfiguratorDock({
  theme,
  onThemeChange,
  highBeams,
  onToggleHighBeams,
  paint,
  onPaintChange,
  orbitMode,
  onToggleOrbit,
  sceneId,
  onSceneChange,
  cockpitMode,
  onToggleCockpit,
  showText = true,
  onToggleText,
}: ConfiguratorDockProps) {
  const [openTab, setOpenTab] = useState<Tab | null>(null)

  const toggleTab = (tab: Tab) => {
    setOpenTab((prev) => (prev === tab ? null : tab))
  }

  return (
    <div className="pointer-events-auto fixed bottom-5 left-1/2 -translate-x-1/2 z-30 flex flex-col items-center max-w-[95vw]">
      {/* ── Compact Floating Selector Tray (Appears above the dock) ── */}
      {openTab && (
        <aside
          aria-label="Customizer Options"
          className="mb-2 w-auto max-w-[92vw] rounded-2xl border border-white/20 bg-[#080a0f]/95 px-4 py-2.5 text-white shadow-[0_12px_36px_rgba(0,0,0,0.8)] backdrop-blur-xl animate-in fade-in slide-in-from-bottom-2 duration-150"
        >
          {/* Paint Swatches Tray */}
          {openTab === 'paint' && (
            <div className="flex flex-col items-center gap-2.5">
              <span className="text-[11px] font-medium tracking-wide text-white/90">
                {PAINT_CONFIGS[paint].name}
              </span>
              <div className="flex items-center gap-3">
                {(Object.keys(PAINT_CONFIGS) as PaintFinish[]).map((p) => {
                  const cfg = PAINT_CONFIGS[p]
                  const isSel = paint === p
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => onPaintChange(p)}
                      title={cfg.name}
                      aria-label={cfg.name}
                      className={`relative flex shrink-0 items-center justify-center rounded-full transition-all cursor-pointer p-0 ${
                        isSel
                          ? 'ring-2 ring-white ring-offset-2 ring-offset-[#080a0f] scale-110'
                          : 'opacity-70 hover:opacity-100 hover:scale-105'
                      }`}
                      style={{ width: '32px', height: '32px', minWidth: '32px', minHeight: '32px' }}
                    >
                      <span
                        className="block shrink-0 rounded-full border border-white/30 shadow-md"
                        style={{
                          backgroundColor: cfg.hex,
                          width: '24px',
                          height: '24px',
                          minWidth: '24px',
                          minHeight: '24px',
                        }}
                      />
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Location Scenes Tray */}
          {openTab === 'scene' && (
            <div className="flex flex-col items-center gap-2.5">
              <span className="text-[11px] font-medium tracking-wide text-white/90">
                {SCENES.find((sc) => sc.id === sceneId)?.name} · <span className="text-white/55">{SCENES.find((sc) => sc.id === sceneId)?.tagline}</span>
              </span>
              <div className="flex items-center gap-2">
                {SCENES.map((sc) => {
                  const isSel = sceneId === sc.id
                  return (
                    <button
                      key={sc.id}
                      type="button"
                      onClick={() => onSceneChange(sc.id)}
                      title={`${sc.name} — ${sc.tagline}`}
                      aria-label={sc.name}
                      aria-pressed={isSel}
                      className={`group flex flex-col items-center gap-1.5 rounded-xl border px-2 py-1.5 transition-all cursor-pointer ${
                        isSel
                          ? 'border-white bg-white/10 scale-105'
                          : 'border-white/10 bg-white/5 opacity-75 hover:opacity-100 hover:border-white/30'
                      }`}
                    >
                      <span
                        className="block h-9 w-14 rounded-md border border-white/20 shadow-md"
                        style={{ background: sc.swatch }}
                      />
                      <span className={`text-[10px] font-medium ${isSel ? 'text-white' : 'text-white/70'}`}>{sc.name}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Studio lighting options tray */}
          {openTab === 'studio' && (
            <div className="flex items-center gap-2 flex-wrap justify-center">
              {/* Studio lighting modes */}
              <div className="flex items-center gap-1 rounded-xl bg-white/5 p-1 border border-white/10">
                {(
                  [
                    { id: 'apex', label: 'Apex' },
                    { id: 'm', label: 'M Track' },
                    { id: 'night', label: 'Night' },
                  ] as const
                ).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => onThemeChange(t.id)}
                    className={`rounded-lg px-2.5 py-1 text-[11px] font-medium transition-all cursor-pointer ${
                      theme === t.id
                        ? 'bg-white text-black font-semibold shadow-sm'
                        : 'text-white/60 hover:text-white'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              {/* Laserlights toggle */}
              <button
                type="button"
                onClick={onToggleHighBeams}
                className={`flex items-center gap-1.5 rounded-xl border px-2.5 py-1 text-[11px] font-medium transition-all cursor-pointer ${
                  highBeams
                    ? 'border-[#E4002B] bg-[#E4002B]/20 text-[#E4002B]'
                    : 'border-white/10 bg-white/5 text-white/60 hover:text-white'
                }`}
              >
                <span>Laserlights</span>
                <span className="text-[9px] uppercase">{highBeams ? 'ON' : 'OFF'}</span>
              </button>
            </div>
          )}
        </aside>
      )}

      {/* ── Main Dock Navigation Bar (Minimalist BMW M Bar) ── */}
      <nav
        aria-label="Vehicle Controls Dock"
        className="flex items-center gap-1.5 whitespace-nowrap rounded-full border border-white/20 bg-[#080a0f]/90 px-3 py-1.5 shadow-[0_10px_30px_rgba(0,0,0,0.8)] backdrop-blur-xl text-white text-[12px]"
      >
        {/* Paint Trigger */}
        <button
          type="button"
          onClick={() => toggleTab('paint')}
          className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 transition-all cursor-pointer ${
            openTab === 'paint'
              ? 'bg-white text-black font-semibold'
              : 'text-white/70 hover:text-white hover:bg-white/10'
          }`}
          title="Customize Paint"
        >
          <span
            className="inline-block shrink-0 rounded-full border border-white/40 shadow-sm"
            style={{
              backgroundColor: PAINT_CONFIGS[paint].hex,
              width: '12px',
              height: '12px',
              minWidth: '12px',
              minHeight: '12px',
            }}
          />
          <span className="hidden sm:inline">Paint</span>
        </button>

        {/* Studio Lighting Trigger */}
        <button
          type="button"
          onClick={() => toggleTab('studio')}
          className={`flex items-center gap-1 rounded-full px-2.5 py-1 transition-all cursor-pointer ${
            openTab === 'studio'
              ? 'bg-white text-black font-semibold'
              : 'text-white/70 hover:text-white hover:bg-white/10'
          }`}
          title="Studio Lighting"
        >
          <span>✦</span>
          <span className="hidden sm:inline">Studio</span>
        </button>

        {/* Location Trigger */}
        <button
          type="button"
          onClick={() => toggleTab('scene')}
          className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 transition-all cursor-pointer ${
            openTab === 'scene'
              ? 'bg-white text-black font-semibold'
              : 'text-white/70 hover:text-white hover:bg-white/10'
          }`}
          title="Change location"
        >
          <span
            className="inline-block shrink-0 rounded-[3px] border border-white/40 shadow-sm"
            style={{ background: SCENES.find((sc) => sc.id === sceneId)?.swatch, width: '16px', height: '11px' }}
          />
          <span className="hidden sm:inline">Location</span>
        </button>

        {/* Divider */}
        <div className="h-4 w-px bg-white/20 mx-0.5" />

        {/* Cockpit — "Get in" */}
        <button
          type="button"
          onClick={onToggleCockpit}
          className={`flex items-center gap-1 rounded-full px-2.5 py-1 transition-all cursor-pointer ${
            cockpitMode
              ? 'bg-[#E4002B] text-white font-semibold shadow-md shadow-[#E4002B]/40'
              : 'text-white/70 hover:text-white hover:bg-white/10'
          }`}
          title={cockpitMode ? 'Get out of the car' : 'Get in — driver’s-eye cockpit view'}
          aria-pressed={cockpitMode}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <circle cx="12" cy="12" r="2.5" />
            <path d="M12 3v6.5M4.5 15.5l5.3-2.2M19.5 15.5l-5.3-2.2" />
          </svg>
          <span className="hidden sm:inline">{cockpitMode ? 'Get out' : 'Get in'}</span>
        </button>

        {/* 360° Free Orbit Mode Toggle */}
        <button
          type="button"
          onClick={onToggleOrbit}
          className={`flex items-center gap-1 rounded-full px-2.5 py-1 transition-all cursor-pointer ${
            orbitMode
              ? 'bg-[#009ADA] text-white font-semibold shadow-md shadow-[#009ADA]/40'
              : 'text-white/70 hover:text-white hover:bg-white/10'
          }`}
          title="Toggle 360° Free Camera Orbit"
        >
          <span>360°</span>
        </button>

        {/* Show / Hide Text Toggle */}
        {onToggleText && (
          <button
            type="button"
            onClick={onToggleText}
            className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 transition-all cursor-pointer ${
              !showText
                ? 'bg-amber-400/20 text-amber-300 font-semibold border border-amber-400/35'
                : 'text-white/70 hover:text-white hover:bg-white/10'
            }`}
            title={showText ? 'Hide hero and section text' : 'Show hero and section text'}
            aria-label="Toggle hero and section text"
            aria-pressed={showText}
          >
            {showText ? (
              <EyeOff className="h-3 w-3" />
            ) : (
              <Eye className="h-3 w-3 text-amber-300" />
            )}
            <span className="hidden sm:inline">{showText ? 'Hide Text' : 'Show Text'}</span>
          </button>
        )}
      </nav>
    </div>
  )
}
