import type { Metadata } from 'next'
import localFont from 'next/font/local'
import LocaleProvider from '@/components/locale-provider'
import './globals.css'

const inter = localFont({
  src: [
    { path: './fonts/inter-latin-wght-normal.woff2', weight: '100 900', style: 'normal' },
    { path: './fonts/inter-latin-wght-italic.woff2', weight: '100 900', style: 'italic' },
  ],
  variable: '--font-inter',
  display: 'swap',
  fallback: ['system-ui', 'Segoe UI', 'Helvetica Neue', 'Arial', 'sans-serif'],
})

const plexSansArabic = localFont({
  src: [
    { path: './fonts/ibm-plex-sans-arabic-400.woff2', weight: '400', style: 'normal' },
    { path: './fonts/ibm-plex-sans-arabic-500.woff2', weight: '500', style: 'normal' },
    { path: './fonts/ibm-plex-sans-arabic-600.woff2', weight: '600', style: 'normal' },
    { path: './fonts/ibm-plex-sans-arabic-700.woff2', weight: '700', style: 'normal' },
  ],
  variable: '--font-plex-sans-arabic',
  display: 'swap',
  fallback: ['Tahoma', 'Arial', 'sans-serif'],
})

export const metadata: Metadata = {
  title: 'BMW M5 CS | Vehicle Studio',
  description:
    'Explore the BMW M5 CS in an interactive 3D studio. Configure the exterior, inspect the details and share your build.',
  keywords: ['BMW', 'BMW M5 CS', 'M5 CS', 'vehicle configurator', '3D vehicle studio'],
  openGraph: {
    title: 'BMW M5 CS | Vehicle Studio',
    description: 'A considered 3D look at the BMW M5 CS. Configure the car and share your build.',
    siteName: 'BMW M5 CS Vehicle Studio',
    type: 'website',
  },
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <body className={`${inter.variable} ${plexSansArabic.variable} antialiased`}>
        <LocaleProvider>{children}</LocaleProvider>
      </body>
    </html>
  )
}
