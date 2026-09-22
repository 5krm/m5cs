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
    "The most powerful BMW 5 Series of all time — 627 hp twin-turbo V8, 70 kg lighter than the M5 Competition, sharpened on the Nürburgring. Scroll through a cinematic 3D studio inspection.",
  keywords: ["BMW", "BMW M5 CS", "M5 CS", "M5", "twin-turbo V8", "sport sedan", "3D showcase"],
  openGraph: {
    title: "BMW M5 CS — Engineered for the Apex",
    description:
      "The most powerful BMW 5 Series of all time — 627 hp twin-turbo V8, sharpened on the Nürburgring. A cinematic scroll-driven 3D inspection.",
    siteName: "BMW M5 CS",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${inter.variable} antialiased`}>{children}</body>
    </html>
  );
}
