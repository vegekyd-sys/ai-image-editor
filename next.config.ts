import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  serverExternalPackages: ['@remotion/renderer', '@remotion/bundler', '@remotion/vercel', '@vercel/sandbox'],
  async rewrites() {
    return [
      {
        source: '/storage/:path*',
        destination: 'https://sdyrtztrjgmmpnirswxt.supabase.co/storage/:path*',
      },
    ];
  },
  turbopack: {
    rules: {
      "*.md": {
        loaders: ["raw-loader"],
        as: "*.js",
      },
    },
  },
  webpack: (config) => {
    config.module.rules.push({
      test: /\.md$/,
      type: "asset/source",
    });
    return config;
  },
};

export default nextConfig;
