'use client'

import dynamic from 'next/dynamic'

const M5Experience = dynamic(
  () => import('@/components/m5-experience'),
  {
    ssr: false,
    loading: () => (
      <div className="flex min-h-screen w-full items-center justify-center bg-[#050608] text-[#e8ddc4]">
        <div className="flex flex-col items-center gap-4">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-white" />
          <span className="text-[12px] uppercase tracking-[0.25em] text-white/50">Loading M5 CS Experience</span>
        </div>
      </div>
    ),
  }
)

export default function Home() {
  return <M5Experience />
}

