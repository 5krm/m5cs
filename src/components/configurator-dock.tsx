'use client'

import { useEffect, useState } from 'react'
import { Button, Card, CardBody, Chip, Divider, Tooltip } from '@heroui/react'
import { Disc3, Eye, MapPin, RotateCcw, Share2, Shuffle, X } from 'lucide-react'
import { randomLocation } from '@/lib/locations/photographic'
import { useLocale } from '@/components/locale-provider'
import { getSiteCopy } from '@/lib/site-copy'
import {
  type StudioTheme, type PaintFinish, type WheelFinish, type CaliperColor, type SceneId,
  PAINT_CONFIGS, WHEEL_CONFIGS, CALIPER_CONFIGS, SCENES,
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
type FinishOption = { hex: string; name: string; nameAr: string }

function FinishOptions<T extends string>({
  label, options, value, onChange, isArabic,
}: {
  label: string
  options: Record<T, FinishOption>
  value: T
  onChange: (id: T) => void
  isArabic: boolean
}) {
  const choice = options[value]
  return (
    <div className="flex flex-col gap-2" role="group" aria-label={label}>
      <p className="text-xs font-medium text-white/85">
        {label} · {isArabic ? choice.nameAr : choice.name}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {(Object.keys(options) as T[]).map((id) => (
          <Tooltip key={id} content={isArabic ? options[id].nameAr : options[id].name}>
            <Button
              isIconOnly
              radius="full"
              variant="bordered"
              aria-label={isArabic ? options[id].nameAr : options[id].name}
              aria-pressed={id === value}
              onPress={() => onChange(id)}
              className={'h-10 w-10 min-w-10 border-white/25 bg-white/10 text-white ' + (id === value ? 'ring-2 ring-white ring-offset-2 ring-offset-[#101820]' : '')}
            >
              <span
                className="h-6 w-6 rounded-full border border-white/25"
                style={{ backgroundColor: options[id].hex }}
              />
            </Button>
          </Tooltip>
        ))}
      </div>
    </div>
  )
}

export default function ConfiguratorDock(p: ConfiguratorDockProps) {
  const [openTab, setOpenTab] = useState<Tab | null>(null)
  const { locale, isArabic } = useLocale()
  const c = getSiteCopy(locale)
  const selectedScene = SCENES.find((scene) => scene.id === p.sceneId) ?? SCENES[0]
  const toggle = (tab: Tab) => setOpenTab((current) => current === tab ? null : tab)

  useEffect(() => {
    if (!openTab) return
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenTab(null)
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [openTab])

  const heading = openTab === 'customize'
    ? (isArabic ? 'تخصيص السيارة' : 'Customize your car')
    : openTab === 'scene' ? c.location : (isArabic ? 'العرض والإضاءة' : 'View & lighting')

  return (
    <div
      className="pointer-events-auto fixed bottom-[max(16px,env(safe-area-inset-bottom))] left-1/2 z-40 flex w-[min(440px,calc(100vw-24px))] -translate-x-1/2 flex-col gap-3 text-white"
      dir={isArabic ? 'rtl' : 'ltr'}
    >
      {openTab && (
        <Card
          id="heroui-configurator-panel"
          aria-label={c.vehicleOptions}
          className="max-h-[min(65vh,540px)] overflow-auto border border-white/20 bg-[#101820]/85 shadow-2xl backdrop-blur-xl"
          radius="lg"
          shadow="lg"
        >
          <CardBody className="gap-4 p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-white">{heading}</h2>
              <Button isIconOnly size="sm" variant="light" aria-label={isArabic ? 'إغلاق' : 'Close'}
                className="text-white" onPress={() => setOpenTab(null)}><X size={18} /></Button>
            </div>
            <Divider className="bg-white/15" />

            {openTab === 'customize' && (
              <>
                <FinishOptions label={c.paint} options={PAINT_CONFIGS} value={p.paint}
                  onChange={p.onPaintChange} isArabic={isArabic} />
                <FinishOptions label={c.wheelFinishTitle} options={WHEEL_CONFIGS} value={p.wheelFinish}
                  onChange={p.onWheelChange} isArabic={isArabic} />
                <FinishOptions label={c.brakeCaliperTitle} options={CALIPER_CONFIGS} value={p.caliperColor}
                  onChange={p.onCaliperChange} isArabic={isArabic} />
                <Button onPress={p.onReset} variant="flat" className="bg-white/10 text-white"
                  startContent={<RotateCcw size={16} />}>{c.resetBuild}</Button>
              </>
            )}

            {openTab === 'view' && (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <Button aria-pressed={p.orbitMode} onPress={p.onToggleOrbit}
                    color={p.orbitMode ? 'primary' : 'default'} variant={p.orbitMode ? 'solid' : 'flat'}
                    className={p.orbitMode ? '' : 'bg-white/10 text-white'}>360° · {c.orbitView}</Button>
                  <Button aria-pressed={p.cockpitMode} onPress={p.onToggleCockpit}
                    color={p.cockpitMode ? 'primary' : 'default'} variant={p.cockpitMode ? 'solid' : 'flat'}
                    className={p.cockpitMode ? '' : 'bg-white/10 text-white'}>{c.cockpit}</Button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {([
                    { id: 'apex', label: c.themeApex },
                    { id: 'm', label: c.themeMTrack },
                    { id: 'night', label: c.themeNight },
                  ] as const).map(({ id, label }) => (
                    <Button key={id} size="sm" aria-pressed={p.theme === id}
                      color={p.theme === id ? 'primary' : 'default'}
                      variant={p.theme === id ? 'solid' : 'flat'}
                      className={p.theme === id ? '' : 'bg-white/10 text-white'}
                      onPress={() => p.onThemeChange(id)}>{label}</Button>
                  ))}
                </div>
              </>
            )}

            {openTab === 'scene' && (
              <>
                <div>
                  <p className="text-sm font-semibold text-white">{isArabic ? selectedScene.nameAr : selectedScene.name}</p>
                  <p className="mt-1 text-xs text-white/60">{isArabic ? selectedScene.taglineAr : selectedScene.tagline}</p>
                </div>
                <Chip variant="flat" size="sm" className="bg-white/10 text-white/80">
                  {p.locationBusy
                    ? (isArabic ? 'جارٍ تجهيز الموقع…' : 'Preparing location…')
                    : (isArabic ? 'اختر الموقع' : 'Choose a location')}
                </Chip>
                <Button isDisabled={p.locationBusy} variant="flat" className="bg-white/15 text-white"
                  onPress={() => p.onSceneChange(randomLocation(p.sceneId))}
                  startContent={<Shuffle size={16} />}>{isArabic ? 'موقع عشوائي' : 'Surprise me'}</Button>
                <div className="grid grid-cols-2 gap-2" aria-busy={p.locationBusy}>
                  {SCENES.map((scene) => (
                    <Button key={scene.id} isDisabled={p.locationBusy} aria-pressed={scene.id === p.sceneId}
                      onPress={() => p.onSceneChange(scene.id)} variant="bordered"
                      className={'h-auto min-h-[84px] flex-col items-start gap-2 whitespace-normal border-white/20 p-3 text-start text-white ' + (scene.id === p.sceneId ? 'bg-white/20 ring-1 ring-white/60' : 'bg-white/5')}>
                      <span className="h-5 w-full rounded-md" style={{ background: scene.swatch }} aria-hidden="true" />
                      <span className="text-xs font-medium">{isArabic ? scene.nameAr : scene.name}{scene.id === p.sceneId ? ' ✓' : ''}</span>
                    </Button>
                  ))}
                </div>
                <a className="text-xs text-white/55 underline" href="https://polyhaven.com"
                  rel="noopener noreferrer" target="_blank">Environments · Poly Haven (CC0)</a>
              </>
            )}
          </CardBody>
        </Card>
      )}

      <Card className="border border-white/20 bg-[#101820]/65 shadow-2xl backdrop-blur-xl" radius="lg">
        <CardBody className="flex-row items-center gap-1 p-2">
          {([
            { id: 'customize', label: isArabic ? 'تخصيص' : 'Customize', Icon: Disc3 },
            { id: 'scene', label: c.location, Icon: MapPin },
            { id: 'view', label: isArabic ? 'العرض' : 'View', Icon: Eye },
          ] as const).map(({ id, label, Icon }) => (
            <Button key={id} variant={openTab === id ? 'solid' : 'light'}
              aria-expanded={openTab === id} aria-controls="heroui-configurator-panel"
              onPress={() => toggle(id)}
              className={'h-14 min-w-0 flex-1 flex-col gap-1 px-1 text-xs ' + (openTab === id ? 'bg-white/20 text-white' : 'text-white/85')}>
              <Icon size={18} aria-hidden="true" />{label}
            </Button>
          ))}
          <Button onPress={p.onShare} variant="flat"
            className="h-14 min-w-0 flex-1 flex-col gap-1 bg-white/15 px-1 text-xs text-white">
            <Share2 size={18} aria-hidden="true" />{isArabic ? 'مشاركة' : 'Share'}
          </Button>
        </CardBody>
      </Card>
      <span className="sr-only" role="status" aria-live="polite">{p.shareMessage}</span>
    </div>
  )
}
