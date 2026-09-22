import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

// Inter — Google Fonts, used for ALL text.
// next/font self-hosts the font (variable wght axis 100–900) with zero layout shift.
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
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
