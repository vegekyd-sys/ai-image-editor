import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  serverExternalPackages: ['@remotion/renderer', '@remotion/bundler'],
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
