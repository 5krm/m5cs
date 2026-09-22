'use client'

import { useSyncExternalStore } from 'react'
import ScrollExperience from '@/components/scroll-experience'

const emptySubscribe = () => () => {}

export default function Home() {
  const mounted = useSyncExternalStore(emptySubscribe, () => true, () => false)

  if (!mounted) {
    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-[#050608] text-[#e8ddc4]">
        <div className="flex flex-col items-center gap-4">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-white" />
          <span className="text-[12px] uppercase tracking-[0.25em] text-white/50">Loading M5 CS Experience</span>
        </div>
      </div>
    )
  }

  return <ScrollExperience />
}

