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
    "Explore and configure the BMW M5 CS in a cinematic 3D showroom. Change its finish, wheels, calipers, lighting, and location, then share your build.",
  keywords: ["BMW", "BMW M5 CS", "M5 CS", "M5", "twin-turbo V8", "sport sedan", "3D showcase"],
  openGraph: {
    title: "BMW M5 CS — Engineered for the Apex",
    description:
      "A cinematic 3D BMW M5 CS configurator. Choose finishes, explore the car, and share your build.",
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
