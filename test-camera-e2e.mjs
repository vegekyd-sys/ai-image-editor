import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

const BASE = 'http://localhost:3000';
const SCREENSHOT_DIR = 'test-results/e2e';
const TEST_IMAGE = 'testcase/043D99A4-760B-4763-8219-B1626F848341.JPG';

async function screenshot(page, name) {
  const p = path.join(SCREENSHOT_DIR, `${name}.png`);
  await page.screenshot({ path: p, fullPage: false });
  console.log(`  📸 ${p}`);
}

async function main() {
  // Desktop viewport
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  // Capture console errors
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  try {
    // 1. Login
    console.log('Step 1: Login...');
    await page.goto(`${BASE}/login`);
    await page.waitForTimeout(3000);

    // Check if redirected to projects (already logged in) or on login page
    if (page.url().includes('/projects')) {
      console.log('  ✅ Already logged in');
    } else {
      const emailInput = page.locator('input[type="email"], input[name="email"], input[placeholder*="email" i]').first();
      const passwordInput = page.locator('input[type="password"]').first();
      if (await emailInput.isVisible({ timeout: 3000 })) {
        await emailInput.fill('test-claude@makaron.app');
        await passwordInput.fill('TestAccount2026!');
        const submitBtn = page.locator('button[type="submit"]').first();
        await submitBtn.click();
        await page.waitForURL('**/projects**', { timeout: 15000 });
      }
    }

    await page.waitForTimeout(2000);
    await screenshot(page, '01-projects-desktop');
    console.log('  ✅ At projects page');

    // 2. Click first project
    console.log('Step 2: Enter project...');
    const projectCard = page.locator('a[href*="/projects/"]').first();
    await projectCard.waitFor({ timeout: 10000 });
    await projectCard.click();
    await page.waitForURL('**/projects/**', { timeout: 15000 });
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(4000);
    await screenshot(page, '02-editor-desktop');
    console.log('  ✅ In editor');

    // 3. Click camera button
    console.log('Step 3: Open camera panel...');
    const cameraBtn = page.locator('button:has(svg path[d*="M23 19"])').first();
    await cameraBtn.waitFor({ timeout: 5000 });
    await cameraBtn.click();
    await page.waitForTimeout(2000);
    await screenshot(page, '03-camera-panel-desktop');
    console.log('  ✅ Camera panel opened');

    // 4. Select right side view (→)
    console.log('Step 4: Set right side view...');
    const rightBtn = page.locator('button:has-text("→")').first();
    await rightBtn.click();
    await page.waitForTimeout(500);
    await screenshot(page, '04-camera-right-view');
    console.log('  ✅ Right side view selected');

    // 5. Click Generate and wait
    console.log('Step 5: Generate...');
    const generateBtn = page.locator('button:has-text("Generate")').first();
    await generateBtn.click();
    await screenshot(page, '05-generating');
    console.log('  ⏳ Waiting for generation (up to 4 min)...');

    // Poll: wait for "Generating..." to disappear or panel to close
    const startTime = Date.now();
    let success = false;
    while (Date.now() - startTime < 240000) { // 4 min
      await page.waitForTimeout(5000);
      const elapsed = Math.round((Date.now() - startTime) / 1000);

      // Check if generating button is still visible
      const isGenerating = await page.locator('button:has-text("Generating")').isVisible().catch(() => false);
      const isPanelOpen = await page.locator('button:has-text("Cancel")').isVisible().catch(() => false);

      if (!isGenerating && !isPanelOpen) {
        // Panel closed = generation complete
        success = true;
        console.log(`  ✅ Done in ${elapsed}s!`);
        break;
      }

      // Check for error
      const hasError = await page.locator('text=Issue').isVisible().catch(() => false);
      if (hasError) {
        console.log(`  ❌ Error after ${elapsed}s`);
        await screenshot(page, '06-error');
        break;
      }

      console.log(`  ... ${elapsed}s elapsed`);
    }

    await page.waitForTimeout(2000);
    await screenshot(page, '06-result-desktop');

    if (success) {
      console.log('\n✅ Full flow test PASSED! New snapshot created.');
    } else {
      console.log('\n⚠️ Generation did not complete in time.');
    }

    // Print console errors if any
    if (consoleErrors.length > 0) {
      console.log('\n📋 Console errors:');
      consoleErrors.forEach(e => console.log('  ', e.substring(0, 200)));
    }

    console.log('\nBrowser stays open 60s for inspection...');
    await page.waitForTimeout(60000);

  } catch (err) {
    console.error('❌ Error:', err.message);
    await screenshot(page, 'error');
    if (consoleErrors.length > 0) {
      console.log('Console errors:', consoleErrors.slice(0, 5));
    }
  } finally {
    await browser.close();
  }
}

main();
