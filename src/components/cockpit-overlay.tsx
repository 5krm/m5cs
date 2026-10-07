'use client'

import type { CockpitCallout } from '@/types/configurator'
import { useLocale } from '@/components/locale-provider'
import { getSiteCopy } from '@/lib/site-copy'

interface CockpitOverlayProps {
  active: boolean
  onExit: () => void
  callouts: CockpitCallout[]
}

export default function CockpitOverlay({ active, onExit, callouts }: CockpitOverlayProps) {
  const { locale, isArabic } = useLocale()
  const copy = getSiteCopy(locale)

  return (
    <div
      aria-hidden={!active}
      className={`pointer-events-none fixed inset-0 z-20 transition-opacity duration-300 ${
        active ? 'opacity-100' : 'opacity-0'
      }`}
    >
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_58%,rgba(0,0,0,0.5)_100%)]" />

      <div className="cockpit-heading absolute left-[clamp(16px,4vw,48px)] top-[88px] flex max-w-[280px] flex-col gap-2">
        <p className="m-0 text-[11px] font-medium text-white/65">{copy.cockpit}</p>
        <h2 className="m-0 text-[clamp(20px,3vw,30px)] font-semibold text-[#f4f5f6]">
          {copy.driverSeat}
        </h2>
        <p className="m-0 text-[12px] text-white/60">{copy.cockpitHint}</p>
        <button
          type="button"
          onClick={onExit}
          tabIndex={active ? 0 : -1}
          className="mt-1 w-fit border-b border-white/40 pb-1 text-[12px] font-medium text-white/85 transition-colors hover:border-white hover:text-white"
        >
          {copy.exitCockpit}
        </button>
      </div>

      {callouts.map((callout) => (
        <div
          key={callout.id}
          id={`cockpit-callout-${callout.id}`}
          className="absolute left-0 top-0 will-change-transform"
          style={{ opacity: 0, transform: 'translate3d(-9999px,-9999px,0)' }}
        >
          <div className="relative -translate-x-1/2 -translate-y-1/2">
            <span className="block h-2.5 w-2.5 rounded-full border border-white/80 bg-white/30" />
            <span className="cockpit-callout-line absolute left-1/2 top-1/2 h-px w-8 -translate-y-1/2 bg-white/50" />
            <div className="cockpit-callout-label absolute left-9 top-1/2 w-[190px] -translate-y-1/2 border-l border-white/30 bg-[#090b0e]/90 px-3 py-2 text-left">
              <p className="m-0 text-[11px] font-semibold text-white">
                {isArabic ? callout.labelAr : callout.label}
              </p>
              <p className="m-0 mt-0.5 text-[10px] leading-snug text-white/60">
                {isArabic ? callout.sublabelAr : callout.sublabel}
              </p>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
