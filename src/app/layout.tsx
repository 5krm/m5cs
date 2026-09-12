import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

// Inter — Google Fonts, weights 400/500/600/700, used for ALL text.
// next/font self-hosts the font (variable wght axis 100–900, which covers
// all four requested weights) with zero layout shift.
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "NeuroLink — Where Memories Live Forever",
  description:
    "Create a beautiful memorial to share their story, photos, cherished moments, and celebrate their life together.",
  keywords: ["memorial", "tribute", "remembrance", "NeuroLink", "memorial website"],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
  openGraph: {
    title: "NeuroLink — Where Memories Live Forever",
    description:
      "Create a beautiful memorial to share their story, photos, cherished moments, and celebrate their life together.",
    siteName: "NeuroLink",
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
