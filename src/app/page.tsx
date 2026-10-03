'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'
import ScrollExperience from '@/components/scroll-experience'
import ExperienceErrorBoundary from '@/components/experience-error-boundary'

const emptySubscribe = () => () => {}

/** How long the splash may stay up before we assume the client bundle is
 *  wedged and tell the user, instead of spinning forever. */
const SPLASH_TIMEOUT_MS = 15000

function Splash({ stalled }: { stalled: boolean }) {
  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-[#050608] px-6 text-[#e8ddc4]">
      <div className="flex max-w-[460px] flex-col items-center gap-4 text-center">
        {!stalled && (
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-white" />
        )}
        <span className="text-[12px] uppercase tracking-[0.25em] text-white/50">
          {stalled ? 'Still loading…' : 'Loading M5 CS Experience'}
        </span>
        {stalled && (
          <>
            <p className="m-0 text-[13.5px] leading-[1.7] text-white/55">
              The experience is taking longer than expected. This usually means a script or the 3D
              model failed to download.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-1 cursor-pointer rounded-full border border-white/20 bg-white/10 px-5 py-2 text-[13px] font-medium text-white transition-colors hover:bg-white/20"
            >
              Reload
            </button>
          </>
        )}
      </div>
    </div>
  )
}

export default function Home() {
  const mounted = useSyncExternalStore(emptySubscribe, () => true, () => false)
  const [stalled, setStalled] = useState(false)

  // Only arms while the splash is still showing; cleared the moment the
  // experience mounts.
  useEffect(() => {
    if (mounted) return
    const id = window.setTimeout(() => setStalled(true), SPLASH_TIMEOUT_MS)
    return () => window.clearTimeout(id)
  }, [mounted])

  if (!mounted) return <Splash stalled={stalled} />

  return (
    <ExperienceErrorBoundary>
      <ScrollExperience />
    </ExperienceErrorBoundary>
  )
}
