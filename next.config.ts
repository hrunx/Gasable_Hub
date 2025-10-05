import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  distDir: '.next',
  // For Cloud Run deployment
  compress: true,
  poweredByHeader: false,
};

export default nextConfig;
