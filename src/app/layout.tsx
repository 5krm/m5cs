import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Inter — used for ALL text.
// Self-hosted via next/font/local (variable wght axis 100–900, Latin subset).
// Vendored from @fontsource-variable/inter v5.3.0 (Inter, SIL OFL 1.1 — see
// src/app/fonts/LICENSE.txt) so the build never depends on fonts.googleapis.com.
const inter = localFont({
  src: [
    {
      path: "./fonts/inter-latin-wght-normal.woff2",
      weight: "100 900",
      style: "normal",
    },
    {
      path: "./fonts/inter-latin-wght-italic.woff2",
      weight: "100 900",
      style: "italic",
    },
  ],
  variable: "--font-inter",
  display: "swap",
  fallback: ["system-ui", "Segoe UI", "Helvetica Neue", "Arial", "sans-serif"],
});

export const metadata: Metadata = {
  title: "BMW M5 CS — Engineered for the Apex",
  description:
    "The most powerful BMW 5 Series of all time — 627 hp twin-turbo V8, 70 kg lighter than the M5 Competition, sharpened on the Nürburgring. Scroll through a cinematic 3D studio inspection. Optimized for slowest internet with 260KB nano model and instant 0KB placeholder.",
  keywords: ["BMW", "BMW M5 CS", "M5 CS", "M5", "twin-turbo V8", "sport sedan", "3D showcase"],
  openGraph: {
    title: "BMW M5 CS — Engineered for the Apex",
    description:
      "The most powerful BMW 5 Series of all time — 627 hp twin-turbo V8, sharpened on the Nürburgring. A cinematic scroll-driven 3D inspection. Fast as fuck on slowest internet.",
    siteName: "BMW M5 CS",
    type: "website",
  },
  // Performance: tell browser this is a high-priority app
  other: {
    "X-DNS-Prefetch-Control": "on",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        {/* ── PERFORMANCE HINTS FOR SLOWEST INTERNET ── */}
        {/* Preconnect to self (for model CDN) */}
        <link rel="preconnect" href="/" />
        <link rel="dns-prefetch" href="/" />
        
        {/* Preload critical brand asset - tiny SVG, instant */}
        <link rel="preload" href="/bmw-logo.svg" as="image" type="image/svg+xml" />
        
        {/* Preload font with high priority - already handled by next/font but we add hint */}
        <link rel="preload" href="/_next/static/media/inter-latin-wght-normal.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        
        {/* Model preload is handled adaptively in page.tsx based on connection speed */}
        {/* We don't hardcode model preload here to avoid wasting bandwidth on slow connections */}
        
        {/* Viewport with performance hints */}
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#050608" />
        <meta name="color-scheme" content="dark" />
        
        {/* Performance: tell browser to prioritize this page */}
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        
        {/* Save-Data hint */}
        <meta httpEquiv="Accept-CH" content="DPR, Viewport-Width, Width, ECT, RTT, Downlink, Save-Data" />
      </head>
      <body className={`${inter.variable} antialiased`}>
        {children}
        
        {/* ── SERVICE WORKER FOR OFFLINE CACHING & INSTANT RELOADS ── */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              // Register service worker for model caching - only if not already registered
              if ('serviceWorker' in navigator) {
                window.addEventListener('load', () => {
                  // Only register if we haven't already, and not in dev
                  if (location.hostname !== 'localhost' && !navigator.serviceWorker.controller) {
                    navigator.serviceWorker.register('/sw.js').catch(() => {});
                  }
                });
              }
              
              // Performance observer for slow internet logging
              if ('PerformanceObserver' in window) {
                try {
                  const observer = new PerformanceObserver((list) => {
                    for (const entry of list.getEntries()) {
                      if (entry.entryType === 'navigation') {
                        const nav = entry;
                        // Log slow connections for adaptive loading
                        if (nav.duration > 3000) {
                          console.log('[perf] Slow navigation:', nav.duration + 'ms');
                        }
                      }
                    }
                  });
                  observer.observe({ entryTypes: ['navigation', 'resource'] });
                } catch {}
              }
              
              // Early connection detection for model tier selection
              (function() {
                const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
                if (conn) {
                  const tier = conn.saveData ? 'nano' : 
                    (conn.downlink < 0.5 ? 'nano' : 
                    (conn.downlink < 1.5 ? 'lite' : 
                    (conn.downlink < 5 ? 'mid' : 'high')));
                  console.log('[m5cs] Connection:', conn.effectiveType, conn.downlink + 'Mbps', 'RTT:' + conn.rtt + 'ms', 'Tier:' + tier, 'SaveData:' + conn.saveData);
                  // Store for later use
                  try { sessionStorage.setItem('m5cs_conn_tier', tier); } catch {}
                }
              })();
            `,
          }}
        />
      </body>
    </html>
  );
}
