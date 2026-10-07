'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import type { Locale } from '@/lib/site-copy'

interface LocaleContextValue {
  locale: Locale
  isArabic: boolean
  toggleLocale: () => void
}

const LocaleContext = createContext<LocaleContextValue>({
  locale: 'en',
  isArabic: false,
  toggleLocale: () => undefined,
})

const STORAGE_KEY = 'm5cs_locale'
const localeListeners = new Set<() => void>()
let browserLocale: Locale = 'en'
let browserLocaleInitialized = false

function browserLanguage(): Locale {
  return typeof window !== 'undefined' && window.navigator.language.toLowerCase().startsWith('ar')
    ? 'ar'
    : 'en'
}

function getInitialLocale(): Locale {
  if (typeof window === 'undefined') return 'en'

  try {
    const saved = window.localStorage.getItem(STORAGE_KEY)
    if (saved === 'ar' || saved === 'en') return saved
  } catch {
    // Storage is optional; use the browser language when it is unavailable.
  }

  return browserLanguage()
}

function getBrowserLocaleSnapshot(): Locale {
  if (!browserLocaleInitialized) {
    browserLocale = getInitialLocale()
    browserLocaleInitialized = true
  }
  return browserLocale
}

function getServerLocaleSnapshot(): Locale {
  return 'en'
}

function emitLocaleChange() {
  localeListeners.forEach((listener) => listener())
}

function subscribeToLocale(listener: () => void) {
  localeListeners.add(listener)

  const handleStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY && event.key !== null) return
    browserLocale = event.newValue === 'ar' || event.newValue === 'en' ? event.newValue : browserLanguage()
    browserLocaleInitialized = true
    emitLocaleChange()
  }

  window.addEventListener('storage', handleStorage)
  return () => {
    localeListeners.delete(listener)
    window.removeEventListener('storage', handleStorage)
  }
}

function updateBrowserLocale(update: Locale | ((current: Locale) => Locale)) {
  const current = getBrowserLocaleSnapshot()
  const next = typeof update === 'function' ? update(current) : update
  if (next === current) return

  browserLocale = next
  browserLocaleInitialized = true
  try {
    window.localStorage.setItem(STORAGE_KEY, next)
  } catch {
    // The in-memory language selection remains available for this visit.
  }
  emitLocaleChange()
}

export default function LocaleProvider({ children }: { children: ReactNode }) {
  // useSyncExternalStore lets the first hydrated render match the server while
  // restoring the saved/browser locale as soon as hydration completes.
  const locale = useSyncExternalStore(
    subscribeToLocale,
    getBrowserLocaleSnapshot,
    getServerLocaleSnapshot,
  )

  useEffect(() => {
    const root = document.documentElement
    root.lang = locale
    root.dir = locale === 'ar' ? 'rtl' : 'ltr'
    root.dataset.locale = locale
  }, [locale])

  const toggleLocale = useCallback(() => {
    updateBrowserLocale((current) => (current === 'ar' ? 'en' : 'ar'))
  }, [])

  const value = useMemo<LocaleContextValue>(
    () => ({
      locale,
      isArabic: locale === 'ar',
      toggleLocale,
    }),
    [locale, toggleLocale],
  )

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
}

export function useLocale(): LocaleContextValue {
  return useContext(LocaleContext)
}
