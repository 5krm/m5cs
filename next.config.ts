import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `standalone` is what the self-hosted `npm start` script consumes
  // (node .next/standalone/server.js). Vercel's Next.js adapter runs its own output file
  // tracing and expects the default `.next` layout, and the Vercel build system sets
  // VERCEL=1 for us — so only emit a standalone bundle when NOT building on Vercel.
  output: process.env.VERCEL ? undefined : "standalone",
  allowedDevOrigins: [
    "ais-dev-yoqjexkikwwqkow4o2za5q-146330742784.europe-west1.run.app",
    "ais-pre-yoqjexkikwwqkow4o2za5q-146330742784.europe-west1.run.app",
    "*.run.app",
    "*.e2b.app",
    "*.vercel.app",
    "localhost",
    "127.0.0.1",
  ],
  compress: true,
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  experimental: {
    optimizePackageImports: ['three', 'gsap', 'lenis', 'framer-motion', 'lucide-react'],
  },
  productionBrowserSourceMaps: false,
  async headers() {
    return [
      {
        // HTML - cache 60s with stale-while-revalidate, NOT no-store (kills slow internet)
        source: "/",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=60, s-maxage=60, stale-while-revalidate=300",
          },
        ],
      },
      {
        source: "/models/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
          {
            key: "Accept-Ranges",
            value: "bytes",
          },
          {
            key: "Cross-Origin-Resource-Policy",
            value: "cross-origin",
          },
        ],
      },
      {
        source: "/audio/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
      {
        source: "/:all*(svg|jpg|jpeg|png|webp|avif|woff2|glb|gltf)",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
