'use client'

import { randomLocation } from '@/lib/locations/photographic'
import { useEffect, useState } from 'react'
import { Disc3, Eye, MapPin, RotateCcw, Share2 } from 'lucide-react'
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
  locationBusy?: boolean
  sceneId: SceneId
  onSceneChange: (id: SceneId) => void
  cockpitMode: boolean
  onToggleCockpit: () => void
}

type Tab = 'customize' | 'view' | 'scene'
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
  locationBusy = false,
  onSceneChange,
  cockpitMode,
  onToggleCockpit,
}: ConfiguratorDockProps) {
  const [openTab, setOpenTab] = useState<Tab | null>(null)
  useEffect(() => {
    if (!openTab) return
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpenTab(null) }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [openTab])
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
          <div className="panel-heading"><strong>{openTab === 'customize' ? (isArabic ? 'اجعلها سيارتك' : 'Make it yours') : openTab === 'scene' ? copy.location : (isArabic ? 'العرض والإضاءة' : 'View & lighting')}</strong><button type="button" onClick={() => setOpenTab(null)} aria-label={isArabic ? 'إغلاق' : 'Close'}>×</button></div>
          {openTab === 'customize' && (
            <div className="flex flex-col items-center gap-3">
              <span className="text-[12px] font-medium text-white/90">{copy.paint} · {finishName(paintOptions, paint)}</span>
              <FinishOptions
                options={paintOptions}
                value={paint}
                onChange={(value) => onPaintChange(value as PaintFinish)}
                label={copy.paint}
              />
            </div>
          )}

          {openTab === 'customize' && (
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

          {openTab === 'customize' && (
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

          {openTab === 'view' && (
            <div className="view-options">
              <button type="button" aria-pressed={orbitMode} onClick={onToggleOrbit}>360° · {copy.orbitView}</button>
              <button type="button" aria-pressed={cockpitMode} onClick={onToggleCockpit}>{copy.cockpit}</button>
            </div>
          )}
          {openTab === 'customize' && <button type="button" className="reset-option" onClick={onReset}><RotateCcw size={14} />{copy.resetBuild}</button>}
          {openTab === 'view' && (
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
              <p role="status" className="m-0 text-[11px] text-white/60">{locationBusy ? (isArabic ? 'جارٍ تجهيز الموقع…' : 'Preparing location…') : (isArabic ? 'اختر خلفية لسيارتك' : 'Choose a setting for your car')}</p>
              <button type="button" disabled={locationBusy} className="random-location" onClick={() => onSceneChange(randomLocation(sceneId))}>{isArabic ? '↻ موقع عشوائي' : '↻ Surprise me'}</button>
              <div className="grid grid-cols-2 gap-2" aria-busy={locationBusy}>
                {SCENES.map((scene) => {
                  const selected = scene.id === sceneId
                  return (
                    <button
                      key={scene.id}
                      type="button"
                      onClick={() => onSceneChange(scene.id)}
                      disabled={locationBusy}
                      aria-label={`${isArabic ? scene.nameAr : scene.name} — ${isArabic ? scene.taglineAr : scene.tagline}`}
                      aria-pressed={selected}
                      title={isArabic ? scene.nameAr : scene.name}
                      className={`location-card flex min-w-0 flex-col items-start gap-2 border p-3 text-start transition-colors ${
                        selected ? 'border-white/70 bg-white/10' : 'border-white/10 hover:border-white/35'
                      }`}
                    >
                      <span className="location-swatch" style={{ background: scene.swatch }} aria-hidden="true" />
                      <span className="truncate text-[12px] text-white/80">
                        {isArabic ? scene.nameAr : scene.name}{selected ? ' ✓' : ''}
                      </span>
                      <span className="text-[10px] leading-relaxed text-white/55">{isArabic ? scene.taglineAr : scene.tagline}</span>
                    </button>
                  )
                })}
              </div>
              <a className="text-[10px] text-white/45 underline" href="https://polyhaven.com" target="_blank" rel="noopener noreferrer">Environments · Poly Haven (CC0)</a>
            </div>
          )}
        </aside>
      )}

      <nav aria-label={copy.vehicleOptions} className="configurator-bar">
        {([
          { id: 'customize', label: isArabic ? 'تخصيص' : 'Customize', Icon: Disc3 },
          { id: 'scene', label: copy.location, Icon: MapPin },
          { id: 'view', label: isArabic ? 'العرض' : 'View', Icon: Eye },
        ] as const).map(({id, label, Icon}) => (
          <button key={id} type="button" className="config-control" onClick={() => toggleTab(id)} aria-expanded={openTab === id} aria-controls="customizer-panel">
            <Icon size={17} aria-hidden="true" /><span>{label}</span>
          </button>
        ))}
        <button type="button" onClick={onShare} className="config-control config-control--share" aria-label={shareMessage || copy.shareBuild}><Share2 size={17} aria-hidden="true" /><span>{isArabic ? 'مشاركة' : 'Share'}</span></button>
        <span className="sr-only" aria-live="polite">{shareMessage}</span>
      </nav>
    </div>
  )
}
