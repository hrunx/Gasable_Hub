import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  distDir: '.next',
  // For Cloud Run deployment
  compress: true,
  poweredByHeader: false,
  async rewrites() {
    // If NEXT_PUBLIC_API_BASE is provided, client uses absolute backend URL;
    // avoid proxying to prevent dev proxy flakiness and ECONNRESETs.
    if ((process.env.NEXT_PUBLIC_API_BASE || '').trim()) {
      return [];
    }
    return [
      {
        source: '/api/:path*',
        destination: 'http://localhost:8000/api/:path*',
      },
    ];
  },
};

export default nextConfig;
