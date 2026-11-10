import type { NextConfig } from "next";

// @aws-sdk/checksums requires @aws-crypto/crc32c, but the trace misses it, so it
// is included explicitly. Globs name pnpm's real package directories
// (node_modules/.pnpm/<pkg>@<ver>/node_modules/**). A glob through a top-level
// symlink such as ./node_modules/@smithy/** copies the same files again under
// every symlinked path, which pushed functions past Vercel's 250 MB limit.
// Each entry keeps the package plus the symlinks it resolves its dependencies
// through. The list is the runtime closure of @aws-crypto/crc32c.
const CRC32C_RUNTIME_INCLUDES = [
  '@aws-crypto+crc32c',
  '@aws-crypto+util',
  '@aws-sdk+types',
  '@smithy+types',
  '@smithy+util-utf8',
  '@smithy+util-buffer-from',
  '@smithy+is-array-buffer',
  'tslib',
].map(pkg => `./node_modules/.pnpm/${pkg}@*/node_modules/**`);

const nextConfig: NextConfig = {
  devIndicators: false,
  async headers() {
    return [
      {
        source: '/home-hero/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
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
      './marketing/**',
    ],
  },
  outputFileTracingIncludes: {
    // Durable video delivery probes and muxes with the deployment OS binary.
    ...Object.fromEntries([
      '/api/agent', '/api/agent/**', '/api/animate', '/api/animate/**',
      '/api/video-snapshot', '/api/video-snapshot/**', '/api/cron/video-poll', '/api/mcp',
    ].map(route => [route, ['./node_modules/.pnpm/ffmpeg-static@*/node_modules/ffmpeg-static/**']])),
    // S3 is also loaded by export, materialize, snapshot polling, and cron routes.
    // Keep its checksum runtime in every API bundle, including re-exported handlers.
    '/api/**': CRC32C_RUNTIME_INCLUDES,
  },
  turbopack: {
    // Keep media class identities together across lazy imports and encoder registration.
    resolveAlias: {
      mediabunny: './node_modules/mediabunny/dist/bundles/mediabunny.mjs',
    },
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
