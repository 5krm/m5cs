'use client'

import {
  HotspotId,
  HOTSPOTS,
  WheelFinish,
  WHEEL_CONFIGS,
  CaliperColor,
  CALIPER_CONFIGS,
} from '@/types/configurator'

interface HotspotsOverlayProps {
  activeHotspot: HotspotId | null
  onSelectHotspot: (id: HotspotId | null) => void
  hoodOpen: boolean
  onToggleHood: () => void
  doorOpen: boolean
  onToggleDoor: () => void
  wheelFinish: WheelFinish
  onChangeWheel: (finish: WheelFinish) => void
  caliperColor: CaliperColor
  onChangeCaliper: (color: CaliperColor) => void
}

export default function HotspotsOverlay({
  activeHotspot,
  onSelectHotspot,
  wheelFinish,
  onChangeWheel,
  caliperColor,
  onChangeCaliper,
}: HotspotsOverlayProps) {
  return (
    <>
      {/* ── 3D Anchored Hotspot Pins (Minimalist BMW M micro-dots) ── */}
      <div className="pointer-events-none fixed inset-0 z-20 overflow-hidden">
        {HOTSPOTS.map((h) => (
          <div
            key={h.id}
            id={`hotspot-pin-${h.id}`}
            style={{ opacity: 0, transform: 'translate3d(-9999px, -9999px, 0)' }}
            className={`pointer-events-auto absolute left-0 top-0 transition-opacity duration-300 ${
              activeHotspot !== null ? 'opacity-0 pointer-events-none' : ''
            }`}
          >
            <button
              type="button"
              onClick={() => onSelectHotspot(h.id)}
              className="group relative -translate-x-1/2 -translate-y-1/2 flex items-center justify-center p-2 cursor-pointer focus:outline-none"
              title={`${h.label} — click to inspect`}
              aria-label={h.label}
            >
              {/* Outer pulsing ring */}
              <span className="relative flex h-5 w-5 items-center justify-center">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#009ADA]/50 opacity-60 duration-1000" />
                <span className="relative flex h-4 w-4 items-center justify-center rounded-full border border-white/70 bg-[#080a0f]/90 shadow-[0_0_10px_rgba(0,154,218,0.8)] backdrop-blur-md transition-transform group-hover:scale-125">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#E4002B]" />
                </span>
              </span>

              {/* Tooltip appears ONLY on hover */}
              <div className="pointer-events-none absolute left-full ml-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 hidden sm:flex flex-col items-start rounded-lg border border-white/20 bg-[#080a0f]/95 px-2.5 py-1 shadow-2xl backdrop-blur-md whitespace-nowrap z-50">
                <span className="text-[11px] font-semibold text-white tracking-wide">
                  {h.label}
                </span>
                <span className="text-[9px] text-white/60">{h.sublabel}</span>
              </div>
            </button>
          </div>
        ))}
      </div>

      {/* ── Discrete Component Inspection Card (Positioned in Bottom-Right Corner) ── */}
      {activeHotspot && (
        <aside
          aria-label="Component Inspection Card"
          className="pointer-events-auto fixed bottom-6 right-6 z-40 w-[92vw] max-w-[360px] max-h-[80vh] overflow-y-auto rounded-2xl border border-white/20 bg-[#080a0f]/95 p-4 text-white shadow-[0_16px_48px_rgba(0,0,0,0.85)] backdrop-blur-xl animate-in fade-in slide-in-from-bottom-4 duration-200"
        >
          {/* Header */}
          <div className="flex items-start justify-between border-b border-white/10 pb-2.5">
            <div>
              <div className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-[#E4002B] animate-pulse" />
                <span className="text-[9px] font-mono uppercase tracking-[0.2em] text-[#009ADA]">
                  M5 CS Inspection
                </span>
              </div>
              <h3 className="mt-0.5 text-[15px] font-bold tracking-tight text-[#f7f4ec]">
                {HOTSPOTS.find((h) => h.id === activeHotspot)?.label}
              </h3>
              <p className="text-[11px] text-white/60">
                {HOTSPOTS.find((h) => h.id === activeHotspot)?.sublabel}
              </p>
            </div>

            <button
              type="button"
              onClick={() => onSelectHotspot(null)}
              className="flex h-6 w-6 items-center justify-center rounded-full border border-white/15 bg-white/5 text-white/70 hover:bg-white/15 hover:text-white transition-all cursor-pointer text-xs"
              title="Close inspection"
              aria-label="Close inspection"
            >
              ✕
            </button>
          </div>

          {/* Content Body Based on Hotspot */}
          <div className="mt-3">
            {activeHotspot === 'engine' && (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-1.5 rounded-xl border border-white/10 bg-white/5 p-2.5 text-center">
                  <div>
                    <span className="block text-[14px] font-bold text-white">627 HP</span>
                    <span className="text-[9px] text-white/50 uppercase">Power</span>
                  </div>
                  <div>
                    <span className="block text-[14px] font-bold text-white">750 Nm</span>
                    <span className="text-[9px] text-white/50 uppercase">Torque</span>
                  </div>
                  <div>
                    <span className="block text-[14px] font-bold text-white">3.0 s</span>
                    <span className="text-[9px] text-white/50 uppercase">0–100</span>
                  </div>
                </div>

                <p className="text-[11px] leading-relaxed text-white/70">
                  4.4-liter BMW M TwinPower Turbo V8 with high-pressure direct injection and cross-bank exhaust manifolds.
                </p>
              </div>
            )}

            {activeHotspot === 'cockpit' && (
              <div className="space-y-3">
                <p className="text-[11px] leading-relaxed text-white/70">
                  Lightweight M Carbon bucket seats upholstered in fine-grain Merino leather with Mugello Red accents, illuminated M5 CS logos, and the Nürburgring Nordschleife circuit outline embossed in the headrests.
                </p>
                <div className="rounded-xl border border-white/10 bg-white/5 p-2.5 space-y-1.5 text-[11px]">
                  <div className="flex justify-between text-white/70">
                    <span>Steering Wheel</span>
                    <span className="text-white font-medium">Alcantara with Red 12-o&apos;clock</span>
                  </div>
                  <div className="flex justify-between text-white/70">
                    <span>Center Console</span>
                    <span className="text-white font-medium">Lightweight CFRP (No Armrest)</span>
                  </div>
                  <div className="flex justify-between text-white/70">
                    <span>Shift Paddles</span>
                    <span className="text-white font-medium">Carbon Fiber with Red Inserts</span>
                  </div>
                </div>
              </div>
            )}

            {activeHotspot === 'wheels' && (
              <div className="space-y-3">
                {/* Wheel finish */}
                <div>
                  <div className="flex items-center justify-between text-[11px] text-white/70 mb-1.5">
                    <span>Wheel Finish (Style 863M)</span>
                    <span className="text-white font-medium">{WHEEL_CONFIGS[wheelFinish].name.split('(')[0]}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {(Object.keys(WHEEL_CONFIGS) as WheelFinish[]).map((finish) => {
                      const cfg = WHEEL_CONFIGS[finish]
                      const isSel = wheelFinish === finish
                      return (
                        <button
                          key={finish}
                          type="button"
                          onClick={() => onChangeWheel(finish)}
                          title={cfg.name}
                          aria-label={cfg.name}
                          className={`relative flex h-7 w-7 items-center justify-center rounded-full transition-all cursor-pointer ${
                            isSel
                              ? 'ring-2 ring-white ring-offset-2 ring-offset-[#080a0f] scale-110'
                              : 'opacity-60 hover:opacity-100'
                          }`}
                        >
                          <span
                            className="h-full w-full rounded-full border border-white/20"
                            style={{ backgroundColor: cfg.hex }}
                          />
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* Caliper color */}
                <div className="pt-1">
                  <div className="flex items-center justify-between text-[11px] text-white/70 mb-1.5">
                    <span>M Carbon Ceramic Calipers</span>
                    <span className="text-white font-medium">{CALIPER_CONFIGS[caliperColor].name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {(Object.keys(CALIPER_CONFIGS) as CaliperColor[]).map((color) => {
                      const cfg = CALIPER_CONFIGS[color]
                      const isSel = caliperColor === color
                      return (
                        <button
                          key={color}
                          type="button"
                          onClick={() => onChangeCaliper(color)}
                          title={cfg.name}
                          aria-label={cfg.name}
                          className={`relative flex h-7 w-7 items-center justify-center rounded-full transition-all cursor-pointer ${
                            isSel
                              ? 'ring-2 ring-white ring-offset-2 ring-offset-[#080a0f] scale-110'
                              : 'opacity-60 hover:opacity-100'
                          }`}
                        >
                          <span
                            className="h-full w-full rounded-full border border-white/20"
                            style={{ backgroundColor: cfg.hex }}
                          />
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>
            )}

            {activeHotspot === 'aero' && (
              <div className="space-y-3">
                <p className="text-[11px] leading-relaxed text-white/70">
                  Exposed Carbon Fiber Reinforced Polymer (CFRP) aero package: lightweight front splitter, aerodynamic mirror caps, rear spoiler, and rear diffuser creating authentic downforce.
                </p>
                <div className="rounded-xl border border-white/10 bg-white/5 p-2.5 space-y-1.5 text-[11px]">
                  <div className="flex justify-between text-white/70">
                    <span>Material</span>
                    <span className="text-white font-medium">Exposed CFRP Weave</span>
                  </div>
                  <div className="flex justify-between text-white/70">
                    <span>Weight Savings</span>
                    <span className="text-[#009ADA] font-semibold">-70 kg vs M5 Competition</span>
                  </div>
                  <div className="flex justify-between text-white/70">
                    <span>Exhaust System</span>
                    <span className="text-white font-medium">Quad Stainless Steel Sport</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="mt-4 pt-2 border-t border-white/10 flex justify-end">
            <button
              type="button"
              onClick={() => onSelectHotspot(null)}
              className="text-[11px] font-medium text-white/60 hover:text-white transition-colors cursor-pointer"
            >
              Back to Overview →
            </button>
          </div>
        </aside>
      )}
    </>
  )
}
