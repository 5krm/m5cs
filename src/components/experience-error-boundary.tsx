'use client'

import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/**
 * Last line of defence around <ScrollExperience>.
 *
 * Without a boundary, any throw during render or inside an effect makes React
 * unmount the entire root — the user is left staring at a blank page (or at
 * the "Loading M5 CS Experience" splash that never resolves, because the
 * mount-gate re-render never commits). This keeps the failure visible and
 * recoverable instead of silent.
 */
export default class ExperienceErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[m5-cs] experience crashed:', error, info.componentStack)
  }

  render() {
    const { error } = this.state

    if (!error) return this.props.children

    return (
      <main className="relative flex min-h-screen w-full items-center justify-center bg-[#050608] px-6 text-[#f2efe7]">
        <div className="w-full max-w-[520px] text-center">
          <img
            src="/bmw-logo.svg"
            alt="BMW"
            width={52}
            height={52}
            className="mx-auto mb-7 h-[52px] w-[52px] object-contain opacity-90"
          />

          <p className="m-0 text-[11px] font-medium uppercase tracking-[0.32em] text-[#e8ddc4]/70">
            BMW M5 CS
          </p>
          <h1 className="m-0 mt-3 text-[clamp(22px,4.5vw,32px)] font-semibold tracking-[-0.02em] text-[#f7f4ec]">
            Something went wrong
          </h1>
          <p className="m-0 mt-4 text-[14px] leading-[1.7] text-white/65">
            The interactive studio stopped before it could finish loading.
          </p>

          <pre className="mt-6 overflow-x-auto rounded-xl border border-white/12 bg-black/40 p-4 text-left text-[12px] leading-[1.6] text-white/55">
            {error.message || String(error)}
          </pre>

          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-7 cursor-pointer rounded-full border border-white/20 bg-white/10 px-6 py-2.5 text-[13px] font-medium text-white transition-colors hover:bg-white/20"
          >
            Reload
          </button>
        </div>
      </main>
    )
  }
}
