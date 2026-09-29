import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  async headers() {
    return [
      {
        source: '/llms.txt',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Cache-Control', value: 'public, max-age=300, s-maxage=3600' },
        ],
      },
      {
        source: '/skill.md',
        headers: [
          { key: 'Content-Type', value: 'text/markdown; charset=utf-8' },
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Cache-Control', value: 'public, max-age=300, s-maxage=3600' },
        ],
      },
      {
        source: '/.well-known/agent-skills/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Cache-Control', value: 'public, max-age=300, s-maxage=3600' },
        ],
      },
    ];
  },
  serverExternalPackages: [
    '@remotion/renderer',
    '@remotion/bundler',
    '@remotion/vercel',
    '@remotion/lambda-client',
    '@vercel/sandbox',
    '@remotion/google-fonts',
  ],
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
      './.claude/**',
      './.codex/**',
      './.tmp/**',
      './.remotion-bundle/**',
      './.remotion-bundle-local/**',
      './.playwright-cli/**',
      './.playwright-mcp/**',
      './artifacts/**',
      './outputs/**',
      './output/**',
      './screenshots/**',
      './mcp-output/**',
      './tmp/**',
      './testcase/**',
      './testcase old/**',
      './test-results/**',
      './app-store-assets/**',
    ],
  },
  outputFileTracingIncludes: {
    '/api/agent/**': [
      './node_modules/@aws-crypto/**',
      './node_modules/@aws-sdk/types/**',
      './node_modules/@smithy/**',
      './node_modules/tslib/**',
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
