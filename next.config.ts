import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  serverExternalPackages: ['@remotion/renderer', '@remotion/bundler', '@remotion/vercel', '@vercel/sandbox', '@remotion/google-fonts'],
  outputFileTracingExcludes: {
    '*': [
      './ios/**',
      './build/**',
      './test-output/**',
      './docs/meta-swipe-runs/**',
      './makaron-intro/renders/**',
      './home-perf-trace*.json*',
      './trace-editor-load*.json*',
      './tsconfig.tsbuildinfo',
    ],
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
