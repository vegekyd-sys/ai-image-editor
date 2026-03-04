import { chromium } from 'playwright';
import path from 'path';

const BASE = 'https://ai-image-editor-civ9nae4v-vegekyd-sys-projects.vercel.app';
const BYPASS = 'cabiOuliMKG9wXJUqwUla0E72PO6bRi5';
const SCREENSHOT_DIR = 'test-results/e2e';
const TEST_IMAGE = 'testcase/14E9B12B-81C5-4834-B236-21A12CF798CC.JPG';

async function screenshot(page, name) {
  const p = path.join(SCREENSHOT_DIR, `${name}.png`);
  await page.screenshot({ path: p, fullPage: false });
  console.log(`  📸 ${p}`);
}

async function main() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const errors = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  // Capture network failures
  page.on('response', res => {
    if (res.status() >= 400 && res.url().includes('/api/')) {
      console.log(`  ⚠️ API ${res.status()}: ${res.url()}`);
    }
  });

  try {
    // 1. Login
    console.log('Step 1: Login...');
    await page.goto(`${BASE}/login?x-vercel-protection-bypass=${BYPASS}&x-vercel-set-bypass-cookie=samesitenone`);
    await page.waitForTimeout(3000);

    if (page.url().includes('/projects')) {
      console.log('  ✅ Already logged in');
    } else {
      const emailInput = page.locator('input[type="email"]').first();
      if (await emailInput.isVisible({ timeout: 3000 })) {
        await emailInput.fill('test-claude@makaron.app');
        await page.locator('input[type="password"]').first().fill('TestAccount2026!');
        await page.locator('button[type="submit"]').first().click();
        await page.waitForURL('**/projects**', { timeout: 15000 });
        console.log('  ✅ Logged in');
      }
    }
    await page.waitForTimeout(2000);
    await screenshot(page, 'preview-01-projects');

    // 2. Upload new image via file input
    console.log('Step 2: Upload test image...');
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(TEST_IMAGE);
    console.log('  Waiting for editor...');
    await page.waitForTimeout(8000);
    await screenshot(page, 'preview-02-editor');

    // Check if we navigated to editor
    if (!page.url().includes('/projects/')) {
      // Try clicking first project instead
      console.log('  Upload didn\'t navigate, clicking first project...');
      const card = page.locator('a[href*="/projects/"]').first();
      await card.click();
      await page.waitForTimeout(5000);
    }
    await screenshot(page, 'preview-03-in-editor');
    console.log('  ✅ In editor');

    // 3. Open camera panel
    console.log('Step 3: Open camera panel...');
    await page.waitForTimeout(3000); // let tips load
    const cameraBtn = page.locator('button:has(svg path[d*="M23 19"])').first();
    if (await cameraBtn.isVisible({ timeout: 5000 })) {
      await cameraBtn.click();
      await page.waitForTimeout(2000);
      await screenshot(page, 'preview-04-camera-panel');
      console.log('  ✅ Camera panel opened');

      // 4. Select angle
      console.log('Step 4: Select right side view...');
      await page.locator('button:has-text("→")').first().click();
      await page.waitForTimeout(500);

      // 5. Generate
      console.log('Step 5: Generate...');
      await page.locator('button:has-text("Generate")').first().click();
      await screenshot(page, 'preview-05-generating');
      console.log('  ⏳ Waiting (up to 4 min)...');

      const start = Date.now();
      while (Date.now() - start < 240000) {
        await page.waitForTimeout(5000);
        const elapsed = Math.round((Date.now() - start) / 1000);

        const isGenerating = await page.locator('button:has-text("Generating")').isVisible().catch(() => false);
        const isPanelOpen = await page.locator('button:has-text("Cancel")').isVisible().catch(() => false);

        if (!isGenerating && !isPanelOpen) {
          console.log(`  ✅ Done in ${elapsed}s!`);
          break;
        }

        // Check for console errors indicating API failure
        if (errors.length > 0) {
          console.log(`  ❌ Errors at ${elapsed}s:`, errors.slice(-2).join(' | '));
          await screenshot(page, 'preview-06-error');
          break;
        }

        console.log(`  ... ${elapsed}s`);
      }

      await page.waitForTimeout(2000);
      await screenshot(page, 'preview-06-result');
    } else {
      console.log('  ❌ Camera button not found');
      await screenshot(page, 'preview-04-no-btn');
    }

    if (errors.length > 0) {
      console.log('\n📋 Console errors:');
      errors.forEach(e => console.log('  ', e.substring(0, 300)));
    }

    console.log('\nBrowser open 60s...');
    await page.waitForTimeout(60000);
  } catch (err) {
    console.error('❌', err.message);
    await screenshot(page, 'preview-error');
  } finally {
    await browser.close();
  }
}

main();
