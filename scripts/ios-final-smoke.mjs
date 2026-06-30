#!/usr/bin/env node

import dotenv from 'dotenv';
import { chromium, devices } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });
dotenv.config();

const args = new Set(process.argv.slice(2));
const baseUrl = process.env.IOS_SMOKE_BASE_URL || 'http://127.0.0.1:3001';
const runLiveAi = args.has('--live-ai');
const runCui = args.has('--cui') || runLiveAi;
const skillLabel = process.env.IOS_SMOKE_SKILL_LABEL || '美食摄影';
const uploadPath = process.env.IOS_SMOKE_IMAGE || path.join(process.cwd(), '.playwright-mcp/codex-skill-qa.jpg');
const smokeEmail = process.env.IOS_SMOKE_EMAIL;
const smokePassword = process.env.IOS_SMOKE_PASSWORD;
const smokeProjectId = process.env.IOS_SMOKE_PROJECT_ID;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const iphone = devices['iPhone 14 Pro'];

function log(label, value) {
  console.log(`${label}: ${typeof value === 'string' ? value : JSON.stringify(value)}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function newPage(extra = {}) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ ...iphone, locale: 'zh-CN', ...extra });
  const page = await context.newPage();
  page.on('pageerror', (err) => console.log(`PAGEERROR: ${err.message.slice(0, 400)}`));
  return { browser, page };
}

async function inspectLoginButtons() {
  const web = await newPage();
  await web.page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' });
  await web.page.waitForTimeout(1000);
  const webButtons = await web.page.locator('button').evaluateAll((buttons) => buttons.map((b) => b.innerText).filter(Boolean));
  await web.browser.close();

  const ios = await newPage({ userAgent: `${iphone.userAgent} MakaronIOS` });
  await ios.page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' });
  await ios.page.waitForTimeout(1000);
  const iosButtons = await ios.page.locator('button').evaluateAll((buttons) => buttons.map((b) => b.innerText).filter(Boolean));
  await ios.browser.close();

  log('loginButtons', { webButtons, iosButtons });
  assert(webButtons.some((text) => text.includes('Google')), 'Web/H5 login must show Google');
  const appleEnabled = process.env.NEXT_PUBLIC_ENABLE_APPLE_LOGIN === 'true';
  if (appleEnabled) {
    assert(iosButtons.some((text) => text.includes('Apple')), 'iOS login must show Apple when enabled');
    assert(iosButtons.some((text) => text.includes('Google')), 'iOS login must show Google only with Apple enabled');
  } else {
    assert(!iosButtons.some((text) => text.includes('Apple')), 'iOS login must not show disabled Apple');
    assert(!iosButtons.some((text) => text.includes('Google')), 'iOS login must not show Google before Apple is enabled');
  }
}

async function verifyRegistrationOtp() {
  assert(supabaseUrl && serviceRoleKey, 'Supabase admin env is required for registration OTP smoke');
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const email = `codex-full-reg-${Date.now()}@makaron.test`;
  const password = 'MakaronQA12345!';
  let userId = null;
  const { browser, page } = await newPage();
  try {
    await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' });
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').fill(password);
    await page.locator('button').filter({ hasText: '继续' }).last().click();
    await page.getByText('输入验证码').waitFor({ timeout: 20000 });
    const otpPage = await page.evaluate(() => ({
      text: document.body.innerText.slice(0, 500),
      inputCount: document.querySelectorAll('input[maxlength="1"]').length,
    }));
    assert(otpPage.inputCount === 8, 'Registration OTP page must render 8 inputs');

    const link = await admin.auth.admin.generateLink({ type: 'magiclink', email });
    if (link.error) throw link.error;
    userId = link.data?.user?.id || null;
    const otp = link.data?.properties?.email_otp;
    assert(otp && otp.length === 8, 'Supabase must return an 8 digit test OTP');

    const otpInputs = page.locator('input[maxlength="1"]');
    for (let i = 0; i < otp.length; i += 1) await otpInputs.nth(i).fill(otp[i]);
    await page.waitForURL(/\/home|\/projects|welcome=1/, { timeout: 30000 }).catch(() => null);
    await page.waitForTimeout(2000);
    const finalState = await page.evaluate(() => ({
      url: location.href,
      text: document.body.innerText.slice(0, 1200),
      hasWelcome: location.href.includes('welcome=1') || document.body.innerText.includes('欢迎') || document.body.innerText.includes('welcome'),
      hasHome: document.body.innerText.includes('Skill 集市') || document.body.innerText.includes('Skill Market'),
    }));
    log('registrationOtp', { email, otpPage, finalState });
    assert(finalState.hasHome, 'Registration must land on Home after OTP verification');
    assert(finalState.hasWelcome, 'Registration must show welcome credits after OTP verification');
  } finally {
    await browser.close();
    if (userId) {
      const { error } = await admin.auth.admin.deleteUser(userId);
      log('registrationCleanup', error ? { error: error.message } : { deleted: userId });
    }
  }
}

async function login(page) {
  assert(smokeEmail && smokePassword, 'IOS_SMOKE_EMAIL and IOS_SMOKE_PASSWORD are required for authenticated smoke flows');
  await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' });
  await page.locator('input[type="email"]').fill(smokeEmail);
  await page.locator('input[type="password"]').fill(smokePassword);
  await page.locator('button').filter({ hasText: '继续' }).last().click();
  await page.waitForURL(/\/(projects|home)/, { timeout: 30000 });
}

async function verifyCuiInline(projectId) {
  assert(projectId, 'IOS_SMOKE_PROJECT_ID is required for --cui unless --live-ai creates one');
  const { browser, page } = await newPage();
  try {
    await login(page);
    await page.goto(`${baseUrl}/projects/${projectId}`, { waitUntil: 'domcontentloaded' });
    await page.locator('[data-testid="editor"]').waitFor({ timeout: 30000 });
    await page.waitForTimeout(1200);
    const chatBox = await page.locator('button').filter({ hasText: 'Chat' }).boundingBox();
    assert(chatBox, 'Chat button must be visible');
    await page.touchscreen.tap(chatBox.x + chatBox.width / 2, chatBox.y + chatBox.height / 2);
    await page.waitForTimeout(1000);
    await page.locator('textarea').last().fill('看 @2');
    await page.getByLabel('Send message').click();
    await page.waitForTimeout(1000);
    const chipCount = await page.locator('[data-makaron-image-ref-chip="true"]').count();
    assert(chipCount > 0, '@x text must render as an image ref chip');
    await page.locator('[data-makaron-image-ref-chip="true"]').last().click();
    await page.waitForTimeout(800);
    const chipState = await page.evaluate(() => ({
      viewMode: document.querySelector('[data-testid="editor"]')?.getAttribute('data-view-mode'),
      previews: document.querySelectorAll('[data-makaron-image-ref-preview="true"]').length,
      hero: document.querySelectorAll('[data-makaron-hero-overlay="true"]').length,
    }));
    assert(chipState.viewMode === 'cui', '@x preview must keep CUI open');
    assert(chipState.previews > 0, '@x chip tap must show a preview');
    assert(chipState.hero === 0, '@x chip tap must not start canvas hero animation');

    const generated = page.locator('button[data-makaron-cui-tap-target="true"] img').locator('..');
    const generatedCount = await generated.count();
    if (generatedCount > 0) {
      await generated.first().click();
      await page.waitForTimeout(1500);
      const imageState = await page.evaluate(() => ({
        viewMode: document.querySelector('[data-testid="editor"]')?.getAttribute('data-view-mode'),
        currentSnapshot: document.querySelector('[data-testid="editor"]')?.getAttribute('data-current-snapshot'),
      }));
      assert(imageState.viewMode === 'gui', 'Generated CUI image tap must return to canvas GUI');
    }
    log('cuiInline', { projectId, chipState, generatedImages: generatedCount });
  } finally {
    await browser.close();
  }
}

async function verifyLiveSkillCreation() {
  assert(smokeEmail && smokePassword, 'IOS_SMOKE_EMAIL and IOS_SMOKE_PASSWORD are required for --live-ai');
  assert(fs.existsSync(uploadPath), `Upload image not found: ${uploadPath}`);
  const { browser, page } = await newPage();
  try {
    await login(page);
    await page.goto(`${baseUrl}/home`, { waitUntil: 'domcontentloaded' });
    await page.waitForResponse((r) => r.url().includes('/api/home-skills') && r.status() === 200, { timeout: 30000 }).catch(() => null);
    await page.getByText(skillLabel, { exact: true }).waitFor({ timeout: 30000 });
    await page.getByText(skillLabel, { exact: true }).click();
    await page.waitForURL(/\/home\?skill=/, { timeout: 15000 });
    await page.waitForTimeout(800);
    const fileInputs = page.locator('input[type="file"]');
    await fileInputs.nth(await fileInputs.count() - 1).setInputFiles(uploadPath);
    await page.waitForTimeout(1000);
    await page.getByText('Create', { exact: true }).last().click();
    await page.waitForURL(/\/projects(\/|$)/, { timeout: 30000 });
    let evidence = null;
    for (let i = 0; i < 240; i += 1) {
      evidence = await page.evaluate(() => {
        const editor = document.querySelector('[data-testid="editor"]');
        return {
          url: location.href,
          projectId: location.pathname.match(/\/projects\/([^/?]+)/)?.[1] || null,
          snapshotCount: editor?.getAttribute('data-snapshot-count') || null,
          agentStatus: editor?.getAttribute('data-agent-status') || null,
          tipsStatus: editor?.getAttribute('data-tips-status') || null,
          generatedButtons: document.querySelectorAll('button[data-makaron-cui-tap-target="true"] img').length,
        };
      });
      if (Number(evidence.snapshotCount || 0) >= 2 && evidence.agentStatus === 'idle' && evidence.generatedButtons >= 1) break;
      await page.waitForTimeout(1000);
    }
    log('liveSkill', evidence);
    assert(Number(evidence?.snapshotCount || 0) >= 2, 'Live skill must create a generated snapshot');
    assert(evidence.agentStatus === 'idle', 'Live skill agent must finish');
    assert(evidence.generatedButtons >= 1, 'Live skill must show generated image in CUI');
    return evidence.projectId;
  } finally {
    await browser.close();
  }
}

async function main() {
  log('config', { baseUrl, runLiveAi, runCui, appleLoginEnabled: process.env.NEXT_PUBLIC_ENABLE_APPLE_LOGIN === 'true' });
  await inspectLoginButtons();
  await verifyRegistrationOtp();
  let projectId = smokeProjectId;
  if (runLiveAi) projectId = await verifyLiveSkillCreation();
  if (runCui) await verifyCuiInline(projectId);
  console.log('ios-final-smoke: PASS');
}

main().catch((error) => {
  console.error('ios-final-smoke: FAIL');
  console.error(error.stack || error.message);
  process.exit(1);
});
