'use client'

import { useState } from 'react'
import { Eye, EyeOff, RotateCcw, Share2 } from 'lucide-react'
import {
  StudioTheme,
  PaintFinish,
  WheelFinish,
  CaliperColor,
  SceneId,
  PAINT_CONFIGS,
  WHEEL_CONFIGS,
  CALIPER_CONFIGS,
  SCENES,
} from '@/types/configurator'

interface ConfiguratorDockProps {
  theme: StudioTheme
  onThemeChange: (t: StudioTheme) => void
  highBeams: boolean
  onToggleHighBeams: () => void
  paint: PaintFinish
  onPaintChange: (p: PaintFinish) => void
  wheelFinish: WheelFinish
  onWheelChange: (finish: WheelFinish) => void
  caliperColor: CaliperColor
  onCaliperChange: (color: CaliperColor) => void
  onShare: () => void
  onReset: () => void
  shareMessage?: string
  orbitMode: boolean
  onToggleOrbit: () => void
  sceneId: SceneId
  onSceneChange: (id: SceneId) => void
  onRandomScene?: () => void
  /** live facts about the active location (surface, air, berth …) */
  sceneFacts?: Array<{ label: string; value: string }>
  cockpitMode: boolean
  onToggleCockpit: () => void
  showText?: boolean
  onToggleText?: () => void
}

type Tab = 'paint' | 'wheels' | 'brakes' | 'studio' | 'scene'

export default function ConfiguratorDock({
  theme,
  onThemeChange,
  highBeams,
  onToggleHighBeams,
  paint,
  onPaintChange,
  wheelFinish,
  onWheelChange,
  caliperColor,
  onCaliperChange,
  onShare,
  onReset,
  shareMessage = '',
  orbitMode,
  onToggleOrbit,
  sceneId,
  onSceneChange,
  onRandomScene,
  sceneFacts = [],
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
          id="customizer-panel"
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
                      aria-pressed={isSel}
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

          {/* Wheel finish tray */}
          {openTab === 'wheels' && (
            <div className="flex min-w-[250px] flex-col items-center gap-3 px-1">
              <div className="flex w-full items-center justify-between gap-4">
                <span className="text-[11px] font-medium text-white/60">20\" Style 863M</span>
                <span className="text-[11px] font-semibold text-white">{WHEEL_CONFIGS[wheelFinish].name}</span>
              </div>
              <div role="group" aria-label="Wheel finish" className="flex items-center gap-3">
                {(Object.keys(WHEEL_CONFIGS) as WheelFinish[]).map((finish) => {
                  const cfg = WHEEL_CONFIGS[finish]
                  const isSel = wheelFinish === finish
                  return (
                    <button
                      key={finish}
                      type="button"
                      onClick={() => onWheelChange(finish)}
                      title={cfg.name}
                      aria-label={cfg.name}
                      aria-pressed={isSel}
                      className={`flex h-9 w-9 items-center justify-center rounded-full border border-white/25 transition-all ${
                        isSel ? 'ring-2 ring-white ring-offset-2 ring-offset-[#080a0f] scale-110' : 'opacity-70 hover:opacity-100'
                      }`}
                    >
                      <span className="h-6 w-6 rounded-full border border-white/20" style={{ backgroundColor: cfg.hex }} />
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Brake caliper tray */}
          {openTab === 'brakes' && (
            <div className="flex min-w-[250px] flex-col items-center gap-3 px-1">
              <div className="flex w-full items-center justify-between gap-4">
                <span className="text-[11px] font-medium text-white/60">M Carbon Ceramic</span>
                <span className="text-[11px] font-semibold text-white">{CALIPER_CONFIGS[caliperColor].name}</span>
              </div>
              <div role="group" aria-label="Brake caliper color" className="flex items-center gap-3">
                {(Object.keys(CALIPER_CONFIGS) as CaliperColor[]).map((color) => {
                  const cfg = CALIPER_CONFIGS[color]
                  const isSel = caliperColor === color
                  return (
                    <button
                      key={color}
                      type="button"
                      onClick={() => onCaliperChange(color)}
                      title={cfg.name}
                      aria-label={cfg.name}
                      aria-pressed={isSel}
                      className={`flex h-9 w-9 items-center justify-center rounded-full border border-white/25 transition-all ${
                        isSel ? 'ring-2 ring-white ring-offset-2 ring-offset-[#080a0f] scale-110' : 'opacity-70 hover:opacity-100'
                      }`}
                    >
                      <span className="h-6 w-6 rounded-full border border-white/20" style={{ backgroundColor: cfg.hex }} />
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Location Scenes Tray */}
          {openTab === 'scene' && (
            <div className="flex flex-col items-center gap-2.5 max-w-full">
              <div className="flex items-center justify-between w-full px-2 gap-3">
                <span className="text-[11px] font-medium tracking-wide text-white/90 truncate">
                  {SCENES.find((sc) => sc.id === sceneId)?.name} · <span className="text-white/55">{SCENES.find((sc) => sc.id === sceneId)?.tagline}</span>
                </span>
                {onRandomScene && (
                  <button
                    type="button"
                    onClick={onRandomScene}
                    title="Switch to a random location"
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-medium bg-white/10 hover:bg-white/20 text-white/90 hover:text-white border border-white/15 transition-all shrink-0 cursor-pointer shadow-sm active:scale-95"
                  >
                    <span>🎲</span>
                    <span>Random Location</span>
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2 max-w-[94vw] overflow-x-auto p-1.5 scrollbar-none sm:flex-wrap sm:justify-center">
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
                      className={`group flex flex-col items-center gap-1.5 rounded-xl border px-2 py-1.5 transition-all cursor-pointer shrink-0 ${
                        isSel
                          ? 'border-white bg-white/15 scale-105 shadow-md shadow-black/40 ring-1 ring-white/50'
                          : 'border-white/10 bg-white/5 opacity-75 hover:opacity-100 hover:border-white/30'
                      }`}
                    >
                      <span
                        className="block h-9 w-14 rounded-md border border-white/20 shadow-md transition-transform group-hover:scale-105"
                        style={{ background: sc.swatch }}
                      />
                      <span className={`text-[10px] font-medium whitespace-nowrap ${isSel ? 'text-white font-semibold' : 'text-white/70'}`}>
                        {sc.name}
                      </span>
                    </button>
                  )
                })}

              </div>

              {sceneFacts.length > 0 && (
                <div className="mt-2.5 grid grid-cols-3 gap-2 border-t border-white/10 pt-2.5">
                  {sceneFacts.map((f) => (
                    <div key={f.label} className="flex flex-col">
                      <span className="text-[9px] uppercase tracking-wider text-white/45">{f.label}</span>
                      <span className="text-[11px] font-medium text-white/90">{f.value}</span>
                    </div>
                  ))}
                </div>
              )}
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
                    aria-pressed={theme === t.id}
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
                aria-pressed={highBeams}
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
        className="flex max-w-[95vw] items-center gap-0.5 overflow-x-auto whitespace-nowrap rounded-full border border-white/20 bg-[#080a0f]/95 px-2 py-1.5 text-white shadow-[0_10px_30px_rgba(0,0,0,0.8)] backdrop-blur-xl sm:gap-1.5 sm:px-3"
      >
        {/* Paint Trigger */}
        <button
          type="button"
          onClick={() => toggleTab('paint')}
          aria-expanded={openTab === 'paint'}
          aria-controls="customizer-panel"
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

        {/* Wheel finish trigger */}
        <button
          type="button"
          onClick={() => toggleTab('wheels')}
          aria-expanded={openTab === 'wheels'}
          aria-controls="customizer-panel"
          className={`flex shrink-0 items-center gap-1.5 rounded-full px-2 py-1 transition-all cursor-pointer sm:px-2.5 ${
            openTab === 'wheels'
              ? 'bg-white text-black font-semibold'
              : 'text-white/70 hover:bg-white/10 hover:text-white'
          }`}
          title="Customize wheel finish"
        >
          <span aria-hidden="true">◉</span>
          <span className="hidden sm:inline">Wheels</span>
        </button>

        {/* Brake caliper trigger */}
        <button
          type="button"
          onClick={() => toggleTab('brakes')}
          aria-expanded={openTab === 'brakes'}
          aria-controls="customizer-panel"
          className={`flex shrink-0 items-center gap-1.5 rounded-full px-2 py-1 transition-all cursor-pointer sm:px-2.5 ${
            openTab === 'brakes'
              ? 'bg-white text-black font-semibold'
              : 'text-white/70 hover:bg-white/10 hover:text-white'
          }`}
          title="Customize brake calipers"
        >
          <span className="inline-block h-3 w-3 rounded-full border border-white/40" style={{ backgroundColor: CALIPER_CONFIGS[caliperColor].hex }} />
          <span className="hidden sm:inline">Brakes</span>
        </button>

        {/* Studio Lighting Trigger */}
        <button
          type="button"
          onClick={() => toggleTab('studio')}
          aria-expanded={openTab === 'studio'}
          aria-controls="customizer-panel"
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
          aria-expanded={openTab === 'scene'}
          aria-controls="customizer-panel"
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

        <div className="mx-0.5 h-4 w-px shrink-0 bg-white/20" />

        <button
          type="button"
          onClick={onShare}
          className="flex shrink-0 items-center gap-1.5 rounded-full bg-white px-2.5 py-1 font-semibold text-black transition-colors hover:bg-white/85 sm:px-3"
          title="Copy a link to this build"
          aria-label={shareMessage ? `Build link ${shareMessage.toLowerCase()}` : 'Share this build'}
        >
          <Share2 className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="hidden sm:inline">{shareMessage || 'Share build'}</span>
        </button>

        <span className="sr-only" aria-live="polite">{shareMessage}</span>

        <button
          type="button"
          onClick={onReset}
          className="flex shrink-0 items-center justify-center rounded-full px-2 py-1 text-white/60 transition-colors hover:bg-white/10 hover:text-white"
          title="Reset to the default build"
          aria-label="Reset build"
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </nav>
    </div>
  )
}
