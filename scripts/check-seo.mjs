#!/usr/bin/env node

const fetchBaseUrl = (process.argv[2] || process.env.SEO_BASE_URL || 'https://www.makaron.app').replace(/\/$/, '');
const publicBaseUrl = (process.env.SEO_PUBLIC_URL || 'https://www.makaron.app').replace(/\/$/, '');

const REQUIRED_SITEMAP_PATHS = [
  '/home',
  '/makaron',
  '/landingpage',
  '/agent',
  '/releases/video-in-timeline',
  '/use-cases',
  '/use-cases/ai-photo-editor',
  '/use-cases/photo-to-video',
  '/use-cases/product-photos',
  '/use-cases/ai-poster-generator',
  '/use-cases/pet-stickers',
  '/use-cases/social-content',
];

const PAGE_CHECKS = [
  {
    path: '/makaron',
    title: 'Makaron AI Creative Studio',
    h1: 'Makaron',
  },
  {
    path: '/use-cases',
    title: 'Makaron Use Cases',
    h1: 'Search-ready ways to use Makaron',
  },
  {
    path: '/use-cases/photo-to-video',
    title: 'AI Photo to Video Maker',
    h1: 'Turn still photos into short cinematic videos',
  },
];

function ok(message) {
  console.log(`✓ ${message}`);
}

function fail(message) {
  throw new Error(message);
}

async function fetchText(path) {
  const url = `${fetchBaseUrl}${path}`;
  const res = await fetch(url, { redirect: 'manual' });
  if (!res.ok) fail(`${url} returned ${res.status}`);
  return { url, text: await res.text() };
}

function expectIncludes(text, needle, label) {
  if (!text.includes(needle)) fail(`Missing ${label}: ${needle}`);
}

function expectCanonical(html, url) {
  expectIncludes(html, `rel="canonical" href="${url}"`, `canonical for ${url}`);
}

function expectNoRobotsNoindex(html, path) {
  if (html.includes('name="robots" content="noindex')) {
    fail(`${path} unexpectedly has noindex robots metadata`);
  }
}

async function checkRobots() {
  const { text } = await fetchText('/robots.txt');
  for (const path of ['/makaron', '/agent', '/home', '/use-cases/', '/releases/']) {
    expectIncludes(text, `Allow: ${path}`, `robots allow ${path}`);
  }
  expectIncludes(text, `Sitemap: ${publicBaseUrl}/sitemap.xml`, 'robots sitemap URL');
  ok('robots.txt allows public SEO paths and points at sitemap');
}

async function checkSitemap() {
  const { text } = await fetchText('/sitemap.xml');
  for (const path of REQUIRED_SITEMAP_PATHS) {
    expectIncludes(text, `<loc>${publicBaseUrl}${path}</loc>`, `sitemap URL ${path}`);
  }
  ok(`sitemap.xml includes ${REQUIRED_SITEMAP_PATHS.length} required public URLs`);
}

async function checkPage({ path, title, h1 }) {
  const { url, text } = await fetchText(path);
  const canonicalUrl = `${publicBaseUrl}${path}`;
  expectIncludes(text, `<title>${title}`, `${path} title`);
  expectCanonical(text, canonicalUrl);
  expectIncludes(text, `property="og:title"`, `${path} og:title`);
  expectIncludes(text, 'application/ld+json', `${path} JSON-LD`);
  expectIncludes(text, `<h1`, `${path} h1 tag`);
  expectIncludes(text, h1, `${path} h1 text`);
  expectNoRobotsNoindex(text, path);
  ok(`${path} has indexable SEO metadata`);
}

async function main() {
  console.log(`Checking SEO surface at ${fetchBaseUrl}`);
  console.log(`Expecting public canonical URLs at ${publicBaseUrl}`);
  await checkRobots();
  await checkSitemap();
  for (const page of PAGE_CHECKS) {
    await checkPage(page);
  }
  console.log('SEO smoke check passed.');
}

main().catch((error) => {
  console.error(`SEO smoke check failed: ${error.message}`);
  process.exit(1);
});
