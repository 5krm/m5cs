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
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  async headers() {
    return [
      {
        source: "/",
        headers: [
          {
            key: "Cache-Control",
            value: "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
          },
          {
            key: "Clear-Site-Data",
            value: '"cache"',
          },
        ],
      },
      {
        source: "/models/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=2592000, immutable",
          },
        ],
      },
      {
        source: "/audio/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=2592000, immutable",
          },
        ],
      },
      {
        source: "/bmw-logo.svg",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=2592000, immutable",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
