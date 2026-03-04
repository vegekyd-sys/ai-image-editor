#!/usr/bin/env node
import { chromium } from 'playwright';
import { join } from 'path';

const HEIC_FILE = join(process.env.HOME, 'Desktop/小宝成长记/IMG_2739.HEIC');
const BASE_URL = 'http://localhost:3000';

async function main() {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  const logs = [];
  page.on('console', msg => {
    const t = msg.text();
    if (msg.type() === 'error' || /heic|convert|upload|ensureDecodable/i.test(t))
      logs.push(`[${msg.type()}] ${t}`);
  });
  page.on('pageerror', err => logs.push('[PAGE_ERR] ' + err.message));

  // 1. Open login page, let user login manually
  console.log('1. Opening login page — please login manually...');
  await page.goto(`${BASE_URL}/login`);

  // 2. Wait until user arrives at /projects (no timeout limit)
  console.log('2. Waiting for /projects (login manually)...');
  while (true) {
    await page.waitForTimeout(2000);
    if (page.url().includes('/projects')) break;
  }
  console.log('   ✓ On projects page');
  await page.waitForTimeout(1000);

  // 3. Upload HEIC via file input
  console.log('3. Uploading HEIC file...');
  const fileInput = page.locator('input[type="file"]').first();
  await fileInput.setInputFiles(HEIC_FILE);
  console.log('   ✓ File set');

  // 4. Wait for editor navigation
  console.log('4. Waiting for editor...');
  while (true) {
    await page.waitForTimeout(1000);
    if (page.url().match(/\/projects\/.+/)) break;
  }
  console.log('   ✓ In editor: ' + new URL(page.url()).pathname);

  // 5. Wait for heic2any conversion + render
  console.log('5. Waiting 15s for HEIC conversion + render...');
  await page.waitForTimeout(15000);

  // 6. Check
  const result = await page.evaluate(() => {
    const imgs = [...document.querySelectorAll('img')];
    const found = imgs.find(i =>
      (i.src.startsWith('data:image/jpeg') || i.src.startsWith('blob:')) && i.naturalWidth > 100
    );
    if (found) return { ok: true, w: found.naturalWidth, h: found.naturalHeight };
    return { ok: false, imgSrcs: imgs.slice(0, 5).map(i => ({ src: i.src.slice(0, 60), w: i.naturalWidth })) };
  });

  await page.screenshot({ path: 'test-result.png' });
  console.log('6. Result:', JSON.stringify(result, null, 2));
  if (logs.length) console.log('   Console logs:', logs);
  console.log(result.ok ? `\n✅ SUCCESS: HEIC → ${result.w}x${result.h}` : '\n❌ FAILED');

  // Keep open for visual inspection
  console.log('\nBrowser stays open 30s for inspection...');
  await page.waitForTimeout(30000);
  await browser.close();
}

main().catch(e => { console.error('Crash:', e.message); process.exit(1); });
