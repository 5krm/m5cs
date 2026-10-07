'use client'

import dynamic from 'next/dynamic'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { useLocale } from '@/components/locale-provider'
import ExperienceErrorBoundary from '@/components/experience-error-boundary'
import { getSiteCopy } from '@/lib/site-copy'

const emptySubscribe = () => () => {}
const SPLASH_TIMEOUT_MS = 15000

function Splash({ stalled }: { stalled: boolean }) {
  const { locale } = useLocale()
  const copy = getSiteCopy(locale)

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-[#090b0e] px-6 text-[#f1f2f3]">
      <div className="flex max-w-[460px] flex-col items-center gap-4 text-center">
        {!stalled && <div className="h-7 w-7 animate-spin rounded-full border-2 border-white/20 border-t-white" />}
        <span className="text-[12px] text-white/60">
          {stalled ? copy.stillLoading : copy.loadingExperience}
        </span>
        {stalled && (
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-1 cursor-pointer rounded-sm border border-white/25 px-5 py-2 text-[13px] font-medium text-white transition-colors hover:bg-white/10"
          >
            {copy.retry}
          </button>
        )}
      </div>
    </div>
  )
}

const ScrollExperience = dynamic(() => import('@/components/scroll-experience'), {
  ssr: false,
  loading: () => <Splash stalled={false} />,
})

export default function Home() {
  const mounted = useSyncExternalStore(emptySubscribe, () => true, () => false)
  const [stalled, setStalled] = useState(false)

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
