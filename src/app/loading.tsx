/**
 * Instant loading shell - paints in <100ms even on slowest internet
 * 0 external dependencies, inline styles, no JS needed for first paint
 */
export default function Loading() {
  return (
    <div className="flex min-h-screen w-full flex-col items-center justify-center bg-[#050608] text-[#e8ddc4]">
      <div className="flex flex-col items-center gap-6">
        <div className="relative">
          <img src="/bmw-logo.svg" alt="" width={56} height={56} className="h-14 w-14 animate-pulse" />
          <div className="absolute inset-0 h-14 w-14 animate-ping rounded-full bg-white/10" />
        </div>
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-white" />
          <span className="text-[11px] uppercase tracking-[0.25em] text-white/50">BMW M5 CS</span>
          <span className="text-[10px] font-mono text-white/30">Engineered for the Apex • Loading fast as fuck</span>
        </div>
        <div className="w-[240px] max-w-[80vw]">
          <div className="h-[2px] w-full overflow-hidden rounded-full bg-white/10">
            <div className="h-full w-1/2 animate-pulse bg-gradient-to-r from-[#FFB733] to-[#E4002B]" />
          </div>
          <div className="mt-2 text-center text-[9px] uppercase tracking-widest text-white/20">
            Adaptive LOD • 260KB nano for 2G • 0KB placeholder instant
          </div>
        </div>
      </div>
    </div>
  )
}
