'use client'

import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { useLocale } from '@/components/locale-provider'
import { getSiteCopy } from '@/lib/site-copy'

interface BoundaryProps {
  children: ReactNode
  renderFallback: (error: Error) => ReactNode
}

interface State {
  error: Error | null
}

/** Keeps render-time failures visible and recoverable instead of blanking the page. */
class ExperienceErrorBoundaryImpl extends Component<BoundaryProps, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[m5-cs] experience crashed:', error, info.componentStack)
  }

  render() {
    const { error } = this.state
    return error ? this.props.renderFallback(error) : this.props.children
  }
}

function ExperienceErrorFallback({ error }: { error: Error }) {
  const { locale, isArabic } = useLocale()
  const copy = getSiteCopy(locale)

  return (
    <main
      lang={locale}
      dir={isArabic ? 'rtl' : 'ltr'}
      className="relative flex min-h-screen w-full items-center justify-center bg-[#090b0e] px-6 text-[#f1f2f3]"
    >
      <div className="w-full max-w-[520px] text-center">
        <img
          src="/bmw-logo.svg"
          alt="BMW"
          width={52}
          height={52}
          className="mx-auto mb-7 h-[52px] w-[52px] object-contain"
        />
        <p className="stage-eyebrow m-0">BMW M5 CS</p>
        <h1 className="m-0 mt-3 text-[clamp(24px,4.5vw,36px)] font-semibold leading-tight text-white">
          {copy.experienceErrorTitle}
        </h1>
        <p className="m-0 mt-4 text-[14px] leading-[1.75] text-white/65">
          {copy.experienceErrorDescription}
        </p>

        <details className="mx-auto mt-6 max-w-[460px] border border-white/10 bg-black/25 p-4 text-start">
          <summary className="cursor-pointer text-[11px] font-medium text-white/55">
            {copy.technicalDetails}
          </summary>
          <pre dir="ltr" className="mb-0 mt-3 overflow-x-auto whitespace-pre-wrap break-words text-left text-[11px] leading-relaxed text-white/45">
            {error.message || String(error)}
          </pre>
        </details>

        <button
          type="button"
          onClick={() => window.location.reload()}
          className="editorial-cta mt-7 cursor-pointer"
        >
          {copy.retry}
        </button>
      </div>
    </main>
  )
}

export default function ExperienceErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <ExperienceErrorBoundaryImpl renderFallback={(error) => <ExperienceErrorFallback error={error} />}>
      {children}
    </ExperienceErrorBoundaryImpl>
  )
}
