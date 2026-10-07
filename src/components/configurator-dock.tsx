'use client'

import { useState } from 'react'
import { Disc3, Eye, MapPin, Orbit, RotateCcw, Share2, Sun } from 'lucide-react'
import { useLocale } from '@/components/locale-provider'
import { getSiteCopy } from '@/lib/site-copy'
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
  onThemeChange: (theme: StudioTheme) => void
  highBeams: boolean
  onToggleHighBeams: () => void
  paint: PaintFinish
  onPaintChange: (paint: PaintFinish) => void
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
  cockpitMode: boolean
  onToggleCockpit: () => void
}

type Tab = 'paint' | 'wheels' | 'brakes' | 'studio' | 'scene'
type ConfigOption = { id: string; label: string; hex: string }

function FinishOptions({
  options,
  value,
  onChange,
  label,
}: {
  options: ConfigOption[]
  value: string
  onChange: (id: string) => void
  label: string
}) {
  return (
    <div role="group" aria-label={label} className="flex items-center gap-3">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          onClick={() => onChange(option.id)}
          title={option.label}
          aria-label={option.label}
          aria-pressed={value === option.id}
          className={`flex h-9 w-9 items-center justify-center rounded-full border transition-colors ${
            value === option.id
              ? 'border-white ring-1 ring-white/70 ring-offset-2 ring-offset-[#090b0e]'
              : 'border-white/25 hover:border-white/70'
          }`}
        >
          <span className="h-6 w-6 rounded-full border border-white/20" style={{ backgroundColor: option.hex }} />
        </button>
      ))}
    </div>
  )
}

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
  cockpitMode,
  onToggleCockpit,
}: ConfiguratorDockProps) {
  const [openTab, setOpenTab] = useState<Tab | null>(null)
  const { locale, isArabic } = useLocale()
  const copy = getSiteCopy(locale)
  const selectedScene = SCENES.find((scene) => scene.id === sceneId) ?? SCENES[0]

  const paintOptions = (Object.keys(PAINT_CONFIGS) as PaintFinish[]).map((id) => ({
    id,
    label: isArabic ? PAINT_CONFIGS[id].nameAr : PAINT_CONFIGS[id].name,
    labelAr: PAINT_CONFIGS[id].nameAr,
    hex: PAINT_CONFIGS[id].hex,
  }))
  const wheelOptions = (Object.keys(WHEEL_CONFIGS) as WheelFinish[]).map((id) => ({
    id,
    label: isArabic ? WHEEL_CONFIGS[id].nameAr : WHEEL_CONFIGS[id].name,
    labelAr: WHEEL_CONFIGS[id].nameAr,
    hex: WHEEL_CONFIGS[id].hex,
  }))
  const caliperOptions = (Object.keys(CALIPER_CONFIGS) as CaliperColor[]).map((id) => ({
    id,
    label: isArabic ? CALIPER_CONFIGS[id].nameAr : CALIPER_CONFIGS[id].name,
    labelAr: CALIPER_CONFIGS[id].nameAr,
    hex: CALIPER_CONFIGS[id].hex,
  }))

  const toggleTab = (tab: Tab) => setOpenTab((current) => (current === tab ? null : tab))
  const finishName = (items: ConfigOption[], id: string) => items.find((item) => item.id === id)?.label ?? ''

  return (
    <div className="configurator-root">
      {openTab && (
        <aside id="customizer-panel" aria-label={copy.vehicleOptions} className="configurator-panel">
          {openTab === 'paint' && (
            <div className="flex flex-col items-center gap-3">
              <span className="text-[12px] font-medium text-white/90">{finishName(paintOptions, paint)}</span>
              <FinishOptions
                options={paintOptions}
                value={paint}
                onChange={(value) => onPaintChange(value as PaintFinish)}
                label={copy.paint}
              />
            </div>
          )}

          {openTab === 'wheels' && (
            <div className="flex min-w-[250px] flex-col items-center gap-3">
              <div className="text-center">
                <p className="m-0 text-[11px] text-white/50">{copy.wheelFinishTitle}</p>
                <p className="m-0 mt-1 text-[12px] font-medium text-white/90">{finishName(wheelOptions, wheelFinish)}</p>
              </div>
              <FinishOptions
                options={wheelOptions}
                value={wheelFinish}
                onChange={(value) => onWheelChange(value as WheelFinish)}
                label={copy.wheels}
              />
            </div>
          )}

          {openTab === 'brakes' && (
            <div className="flex min-w-[250px] flex-col items-center gap-3">
              <div className="text-center">
                <p className="m-0 text-[11px] text-white/50">{copy.brakeCaliperTitle}</p>
                <p className="m-0 mt-1 text-[12px] font-medium text-white/90">{finishName(caliperOptions, caliperColor)}</p>
              </div>
              <FinishOptions
                options={caliperOptions}
                value={caliperColor}
                onChange={(value) => onCaliperChange(value as CaliperColor)}
                label={copy.brakes}
              />
            </div>
          )}

          {openTab === 'studio' && (
            <div className="flex min-w-[250px] flex-col items-center gap-3">
              <div className="flex items-center gap-1 border-b border-white/10 pb-3">
                {(
                  [
                    { id: 'apex', label: copy.themeApex },
                    { id: 'm', label: copy.themeMTrack },
                    { id: 'night', label: copy.themeNight },
                  ] as const
                ).map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => onThemeChange(option.id)}
                    aria-pressed={theme === option.id}
                    className={`rounded-sm px-3 py-1.5 text-[11px] transition-colors ${
                      theme === option.id ? 'bg-white text-black' : 'text-white/65 hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={onToggleHighBeams}
                aria-pressed={highBeams}
                className="flex items-center gap-3 text-[11px] text-white/75 hover:text-white"
              >
                <span>{copy.laserlights}</span>
                <span className={`text-[10px] ${highBeams ? 'text-[#e15369]' : 'text-white/45'}`}>
                  {highBeams ? copy.on : copy.off}
                </span>
              </button>
            </div>
          )}

          {openTab === 'scene' && (
            <div className="flex w-full min-w-[260px] flex-col gap-3">
              <div>
                <p className="m-0 text-[12px] font-medium text-white/90">{isArabic ? selectedScene.nameAr : selectedScene.name}</p>
                <p className="m-0 mt-1 text-[10px] text-white/50">
                  {isArabic ? selectedScene.taglineAr : selectedScene.tagline}
                </p>
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                {SCENES.map((scene) => {
                  const selected = scene.id === sceneId
                  return (
                    <button
                      key={scene.id}
                      type="button"
                      onClick={() => onSceneChange(scene.id)}
                      aria-label={`${isArabic ? scene.nameAr : scene.name} — ${isArabic ? scene.taglineAr : scene.tagline}`}
                      aria-pressed={selected}
                      title={isArabic ? scene.nameAr : scene.name}
                      className={`flex min-w-0 flex-col items-start gap-1 border px-2 py-1.5 text-start transition-colors ${
                        selected ? 'border-white/70 bg-white/10' : 'border-white/10 hover:border-white/35'
                      }`}
                    >
                      <span className="h-1 w-5" style={{ background: scene.swatch }} />
                      <span className="truncate text-[10px] text-white/80">
                        {isArabic ? scene.nameAr : scene.name}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </aside>
      )}

      <nav aria-label={copy.vehicleOptions} className="configurator-bar">
        <button
          type="button"
          onClick={() => toggleTab('paint')}
          aria-expanded={openTab === 'paint'}
          aria-controls="customizer-panel"
          className="config-control"
          title={copy.paint}
        >
          <span className="h-3 w-3 rounded-full border border-white/35" style={{ backgroundColor: PAINT_CONFIGS[paint].hex }} />
          <span className="hidden sm:inline">{copy.paint}</span>
        </button>
        <button
          type="button"
          onClick={() => toggleTab('wheels')}
          aria-expanded={openTab === 'wheels'}
          aria-controls="customizer-panel"
          className="config-control"
          title={copy.wheels}
        >
          <Disc3 className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="hidden sm:inline">{copy.wheels}</span>
        </button>
        <button
          type="button"
          onClick={() => toggleTab('brakes')}
          aria-expanded={openTab === 'brakes'}
          aria-controls="customizer-panel"
          className="config-control"
          title={copy.brakes}
        >
          <span className="h-3 w-3 rounded-full border border-white/35" style={{ backgroundColor: CALIPER_CONFIGS[caliperColor].hex }} />
          <span className="hidden sm:inline">{copy.brakes}</span>
        </button>
        <button
          type="button"
          onClick={() => toggleTab('studio')}
          aria-expanded={openTab === 'studio'}
          aria-controls="customizer-panel"
          className="config-control"
          title={copy.studioLighting}
        >
          <Sun className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="hidden sm:inline">{copy.studioLighting}</span>
        </button>
        <button
          type="button"
          onClick={() => toggleTab('scene')}
          aria-expanded={openTab === 'scene'}
          aria-controls="customizer-panel"
          className="config-control"
          title={copy.locationScene}
        >
          <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="hidden sm:inline">{copy.locationScene}</span>
        </button>

        <span className="configurator-divider" aria-hidden="true" />

        <button
          type="button"
          onClick={onToggleCockpit}
          className="config-control"
          title={copy.viewCockpit}
          aria-label={copy.viewCockpit}
          aria-pressed={cockpitMode}
        >
          <Eye className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="hidden sm:inline">{copy.cockpit}</span>
        </button>
        <button
          type="button"
          onClick={onToggleOrbit}
          className="config-control"
          title={copy.orbitView}
          aria-label={copy.orbitView}
          aria-pressed={orbitMode}
        >
          <Orbit className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="text-[10px] font-semibold">360°</span>
        </button>

        <span className="configurator-divider" aria-hidden="true" />

        <button
          type="button"
          onClick={onShare}
          className="config-control config-control--share"
          title={shareMessage || copy.shareBuild}
          aria-label={shareMessage || copy.shareBuild}
        >
          <Share2 className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="hidden sm:inline">{shareMessage || copy.shareBuild}</span>
        </button>
        <button
          type="button"
          onClick={onReset}
          className="config-control px-2"
          title={copy.resetBuild}
          aria-label={copy.resetBuild}
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
        <span className="sr-only" aria-live="polite">{shareMessage}</span>
      </nav>
    </div>
  )
}
