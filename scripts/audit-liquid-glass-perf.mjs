#!/usr/bin/env node

import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { stdin as input, stdout as output } from 'node:process'
import readline from 'node:readline/promises'
import { chromium, devices } from 'playwright'

const DEFAULT_BASE_URL = process.env.MKR_PERF_BASE_URL || 'http://localhost:3017'
const DEFAULT_PROFILE_DIR = '.tmp/makaron-perf-profile'

const DEFAULT_BUDGETS = {
  visibleBackdropFilterCount: 18,
  largeBackdropFilterCount: 1,
  navSvgFilterCount: 0,
  timelineDotsWithBackdropFilter: 0,
  liquidAnimatedElementCount: 0,
  liquidControlPseudoAnimatedElementCount: 0,
  nextErrorOverlayCount: 0,
  routeSwitchDurationMs: 650,
  longTaskCount: 3,
  maxLongTaskMs: 120,
  totalLongTaskMs: 250,
}

function parseArgs(argv) {
  const options = {
    baseUrl: DEFAULT_BASE_URL,
    projectId: process.env.MKR_PERF_PROJECT_ID || '',
    projectUrl: process.env.MKR_PERF_PROJECT_URL || '',
    profileDir: process.env.MKR_PERF_PROFILE_DIR || DEFAULT_PROFILE_DIR,
    storageState: process.env.MKR_PERF_STORAGE_STATE || '',
    viewports: process.env.MKR_PERF_VIEWPORTS || 'desktop,mobile',
    headed: false,
    login: false,
    json: false,
    strict: false,
    timeoutMs: Number(process.env.MKR_PERF_TIMEOUT_MS || 20_000),
    settleMs: Number(process.env.MKR_PERF_SETTLE_MS || 700),
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (!arg.startsWith('--')) continue
    const [rawKey, inlineValue] = arg.slice(2).split('=')
    const key = rawKey.trim()
    const value = inlineValue ?? argv[i + 1]
    const consumedNext = inlineValue === undefined && value && !value.startsWith('--')

    if (key === 'headed') options.headed = true
    else if (key === 'login') options.login = true
    else if (key === 'json') options.json = true
    else if (key === 'strict') options.strict = true
    else if (key === 'base-url' && value) options.baseUrl = value
    else if (key === 'project-id' && value) options.projectId = value
    else if (key === 'project-url' && value) options.projectUrl = value
    else if (key === 'profile-dir' && value) options.profileDir = value
    else if (key === 'storage-state' && value) options.storageState = value
    else if (key === 'viewports' && value) options.viewports = value
    else if (key === 'timeout-ms' && value) options.timeoutMs = Number(value)
    else if (key === 'settle-ms' && value) options.settleMs = Number(value)
    else if (key === 'help') {
      printHelp()
      process.exit(0)
    }

    if (consumedNext && !['headed', 'login', 'json', 'strict', 'help'].includes(key)) i += 1
  }

  options.baseUrl = options.baseUrl.replace(/\/$/, '')
  return options
}

function printHelp() {
  console.log(`Makaron Liquid Glass performance audit

Usage:
  npm run audit:glass -- [options]

Options:
  --base-url <url>          Default: ${DEFAULT_BASE_URL}
  --project-id <id>         Adds /projects/<id> to the audit
  --project-url <url>       Adds an explicit project URL or path
  --viewports <list>        desktop,mobile,both. Default: desktop,mobile
  --headed                  Show Chromium while auditing
  --login                   Open /login first and wait for Enter
  --profile-dir <path>      Persistent Playwright profile. Default: ${DEFAULT_PROFILE_DIR}
  --storage-state <path>    Use a Playwright storageState JSON instead of a profile
  --strict                  Exit non-zero on budget warnings
  --json                    Print full JSON report

Recommended:
  npm run build
  PORT=3027 npm run start
  npm run audit:glass -- --base-url=http://localhost:3027 --project-id=<id> --strict
`)
}

function viewportSpecs(viewportsArg) {
  const requested = viewportsArg
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .flatMap((item) => item === 'both' ? ['desktop', 'mobile'] : [item])

  const unique = [...new Set(requested.length ? requested : ['desktop', 'mobile'])]
  return unique.map((name) => {
    if (name === 'mobile') {
      return {
        name,
        contextOptions: {
          ...devices['iPhone 15 Pro'],
        },
      }
    }
    return {
      name: 'desktop',
      contextOptions: {
        viewport: { width: 1280, height: 900 },
        deviceScaleFactor: 1,
      },
    }
  })
}

function makeAbsoluteUrl(baseUrl, pathOrUrl) {
  if (!pathOrUrl) return ''
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl
  return `${baseUrl}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`
}

function projectPath(options) {
  if (options.projectUrl) return options.projectUrl
  if (options.projectId) return `/projects/${options.projectId}`
  return ''
}

async function createBrowserContext(options, viewport) {
  if (options.storageState) {
    if (!existsSync(options.storageState)) {
      throw new Error(`storage state file not found: ${options.storageState}`)
    }
    const browser = await chromium.launch({ headless: !options.headed })
    const context = await browser.newContext({
      ...viewport.contextOptions,
      storageState: options.storageState,
    })
    return {
      context,
      close: async () => browser.close(),
    }
  }

  const profileRoot = path.resolve(options.profileDir)
  mkdirSync(profileRoot, { recursive: true })
  const context = await chromium.launchPersistentContext(profileRoot, {
    ...viewport.contextOptions,
    headless: !options.headed,
  })
  return {
    context,
    close: async () => context.close(),
  }
}

async function waitForManualLogin(page, options) {
  await page.goto(makeAbsoluteUrl(options.baseUrl, '/login'), {
    waitUntil: 'domcontentloaded',
    timeout: options.timeoutMs,
  })
  console.log('\nLogin requested. Finish login in the Chromium window, then press Enter here.')
  const rl = readline.createInterface({ input, output })
  await rl.question('Press Enter after login is complete...')
  rl.close()
}

async function settle(page, options) {
  await page.waitForLoadState('domcontentloaded', { timeout: options.timeoutMs }).catch(() => {})
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {})
  await page.waitForTimeout(options.settleMs)
}

async function waitForPageSurface(page, label, options) {
  const selectors = {
    home: '.mkr-input-box-liquid, .mkr-liquid-nav',
    projects: '.makaron-projects-page, .mkr-liquid-nav',
    'project editor': '.mkr-liquid-timeline-rail, .mkr-liquid-timeline-dot, .mkr-liquid-media-badge, .mkr-liquid-play-button, .makaron-editor-shell',
  }
  const selector = selectors[label]
  if (!selector) return
  await page.waitForSelector(selector, { timeout: Math.min(options.timeoutMs, 25_000) }).catch(() => {})
  await page.waitForTimeout(options.settleMs)
}

async function installLongTaskObserver(page) {
  await page.evaluate(() => {
    window.__mkrPerfLongTasks = []
    try {
      window.__mkrPerfLongTaskObserver?.disconnect?.()
    } catch {
      // Best effort cleanup across route transitions.
    }

    const supported = typeof PerformanceObserver !== 'undefined'
      && PerformanceObserver.supportedEntryTypes
      && PerformanceObserver.supportedEntryTypes.includes('longtask')

    if (!supported) {
      window.__mkrPerfLongTaskSupported = false
      return
    }

    window.__mkrPerfLongTaskSupported = true
    window.__mkrPerfLongTaskObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        window.__mkrPerfLongTasks.push({
          name: entry.name,
          startTime: Math.round(entry.startTime),
          duration: Math.round(entry.duration),
        })
      }
    })
    window.__mkrPerfLongTaskObserver.observe({ type: 'longtask', buffered: true })
  }).catch(() => {})
}

async function readLongTasks(page) {
  return page.evaluate(() => ({
    supported: Boolean(window.__mkrPerfLongTaskSupported),
    tasks: window.__mkrPerfLongTasks || [],
  })).catch(() => ({ supported: false, tasks: [] }))
}

function summarizeLongTasks(longTaskResult) {
  const tasks = longTaskResult.tasks || []
  const durations = tasks.map((task) => task.duration || 0)
  return {
    supported: longTaskResult.supported,
    count: tasks.length,
    maxMs: durations.length ? Math.max(...durations) : 0,
    totalMs: durations.reduce((sum, duration) => sum + duration, 0),
    tasks: tasks.slice(0, 8),
  }
}

async function collectPageMetrics(page) {
  return page.evaluate(() => {
    const viewportArea = Math.max(1, window.innerWidth * window.innerHeight)
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight

    function isVisible(element) {
      const rect = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      const intersectsViewport = rect.right > 0
        && rect.bottom > 0
        && rect.left < viewportWidth
        && rect.top < viewportHeight
      return rect.width > 0
        && rect.height > 0
        && intersectsViewport
        && style.display !== 'none'
        && style.visibility !== 'hidden'
        && Number(style.opacity || '1') > 0.01
    }

    function hasBackdrop(style) {
      const backdrop = style.backdropFilter || style.webkitBackdropFilter || ''
      return Boolean(backdrop && backdrop !== 'none')
    }

    function hasAnimation(style) {
      if (!style.animationName
        || style.animationName === 'none'
        || style.animationDuration === '0s'
        || style.animationDuration === '0ms') return false
      return style.animationIterationCount
        .split(',')
        .map((value) => value.trim())
        .some((value) => value === 'infinite' || Number(value) > 1)
    }

    function describe(element) {
      const rect = element.getBoundingClientRect()
      const classes = typeof element.className === 'string'
        ? element.className
        : String(element.getAttribute('class') || '')
      return {
        tag: element.tagName.toLowerCase(),
        id: element.id || '',
        className: classes.slice(0, 140),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        areaRatio: Number(((rect.width * rect.height) / viewportArea).toFixed(4)),
      }
    }

    const all = [...document.querySelectorAll('*')]
    const visible = all.filter(isVisible)
    const liquid = visible.filter((element) => [...element.classList].some((name) => name.startsWith('mkr-liquid')))
    const visibleBackdrops = visible.filter((element) => hasBackdrop(getComputedStyle(element)))
    const liquidBackdrops = visibleBackdrops.filter((element) => [...element.classList].some((name) => name.startsWith('mkr-liquid')))
    const largeBackdrops = visibleBackdrops.filter((element) => {
      const rect = element.getBoundingClientRect()
      return (rect.width * rect.height) / viewportArea > 0.35
    })
    const liquidAnimated = liquid.filter((element) => hasAnimation(getComputedStyle(element)))
    const liquidPseudoAnimated = liquid.filter((element) => {
      const before = getComputedStyle(element, '::before')
      const after = getComputedStyle(element, '::after')
      return hasAnimation(before) || hasAnimation(after)
    })
    const placeholderPseudoAnimated = liquidPseudoAnimated.filter((element) => (
      element.classList.contains('mkr-liquid-placeholder')
      || element.classList.contains('mkr-liquid-empty-state')
    ))
    const liquidControlPseudoAnimated = liquidPseudoAnimated.filter((element) => (
      !element.classList.contains('mkr-liquid-placeholder')
      && !element.classList.contains('mkr-liquid-empty-state')
    ))
    const timelineDots = [...document.querySelectorAll('.mkr-liquid-timeline-dot')]
    const timelineDotsWithBackdrop = timelineDots.filter((element) => hasBackdrop(getComputedStyle(element)))
    const navigation = performance.getEntriesByType('navigation')[0]
    const memory = performance.memory || null

    return {
      url: location.href,
      pathname: location.pathname,
      title: document.title,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio,
      },
      nodeCount: all.length,
      visibleNodeCount: visible.length,
      visibleBackdropFilterCount: visibleBackdrops.length,
      visibleLiquidBackdropFilterCount: liquidBackdrops.length,
      largeBackdropFilterCount: largeBackdrops.length,
      maxBackdropAreaRatio: visibleBackdrops.length
        ? Math.max(...visibleBackdrops.map((element) => {
            const rect = element.getBoundingClientRect()
            return Number(((rect.width * rect.height) / viewportArea).toFixed(4))
          }))
        : 0,
      liquidElementCount: liquid.length,
      liquidAnimatedElementCount: liquidAnimated.length,
      liquidPseudoAnimatedElementCount: liquidPseudoAnimated.length,
      liquidControlPseudoAnimatedElementCount: liquidControlPseudoAnimated.length,
      placeholderPseudoAnimatedElementCount: placeholderPseudoAnimated.length,
      timelineDotCount: timelineDots.length,
      timelineDotsWithBackdropFilter: timelineDotsWithBackdrop.length,
      navSvgFilterCount: document.querySelectorAll('.mkr-liquid-nav svg, .mkr-liquid-nav filter, .mkr-liquid-nav feTurbulence, .mkr-liquid-nav feDisplacementMap').length,
      navButtonCount: document.querySelectorAll('.mkr-liquid-nav-button').length,
      navIndicatorCount: document.querySelectorAll('.mkr-liquid-nav-indicator').length,
      mediaBadgeCount: document.querySelectorAll('.mkr-liquid-media-badge').length,
      sideActionCount: document.querySelectorAll('.mkr-liquid-side-action').length,
      inputEnergyBoxCount: document.querySelectorAll('.mkr-input-box-liquid').length,
      nextErrorOverlayCount: document.querySelectorAll('[data-nextjs-dialog-overlay], nextjs-portal').length,
      usedJSHeapSizeMB: memory ? Number((memory.usedJSHeapSize / 1024 / 1024).toFixed(1)) : null,
      navigationDurationMs: navigation ? Math.round(navigation.duration) : null,
      topBackdropNodes: visibleBackdrops.slice(0, 8).map(describe),
      animatedLiquidNodes: liquidAnimated.slice(0, 8).map(describe),
      pseudoAnimatedLiquidNodes: liquidPseudoAnimated.slice(0, 8).map(describe),
      pseudoAnimatedLiquidControlNodes: liquidControlPseudoAnimated.slice(0, 8).map(describe),
      authRedirected: location.pathname.startsWith('/login'),
    }
  })
}

async function gotoAndMeasure(page, label, url, options) {
  const start = Date.now()
  const expectedPathname = new URL(url).pathname
  await installLongTaskObserver(page)
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: options.timeoutMs })
  await settle(page, options)
  await waitForPageSurface(page, label, options)
  const metrics = await collectPageMetrics(page)
  const actualPathname = new URL(metrics.url).pathname
  const longTasks = summarizeLongTasks(await readLongTasks(page))
  return {
    label,
    url,
    expectedPathname,
    routeMismatch: expectedPathname !== actualPathname,
    wallTimeMs: Date.now() - start,
    metrics,
    longTasks,
  }
}

async function measureClickInteraction(page, label, locator, waitFor, options) {
  const targetCount = await locator.count().catch(() => 0)
  if (targetCount === 0) {
    return { label, skipped: true, reason: 'target not found' }
  }

  await installLongTaskObserver(page)
  const start = Date.now()
  await locator.first().click({ timeout: options.timeoutMs })
  if (waitFor) await waitFor()
  const responseMs = Date.now() - start
  await settle(page, options)
  const settledMs = Date.now() - start
  const longTasks = summarizeLongTasks(await readLongTasks(page))
  return {
    label,
    responseMs,
    settledMs,
    longTasks,
  }
}

function checkMetric(label, value, max, warnings) {
  if (typeof value !== 'number' || Number.isNaN(value)) return
  if (value > max) warnings.push(`${label}: ${value} > ${max}`)
}

function addBudgetWarnings(result, budgets) {
  const warnings = []
  for (const pageResult of result.pages) {
    const prefix = `${result.viewport}/${pageResult.label}`
    const metrics = pageResult.metrics
    if (pageResult.routeMismatch) warnings.push(`${prefix} route mismatch: expected ${pageResult.expectedPathname}, got ${metrics.pathname}`)
    checkMetric(`${prefix} visibleBackdropFilterCount`, metrics.visibleBackdropFilterCount, budgets.visibleBackdropFilterCount, warnings)
    checkMetric(`${prefix} largeBackdropFilterCount`, metrics.largeBackdropFilterCount, budgets.largeBackdropFilterCount, warnings)
    checkMetric(`${prefix} navSvgFilterCount`, metrics.navSvgFilterCount, budgets.navSvgFilterCount, warnings)
    checkMetric(`${prefix} timelineDotsWithBackdropFilter`, metrics.timelineDotsWithBackdropFilter, budgets.timelineDotsWithBackdropFilter, warnings)
    checkMetric(`${prefix} liquidAnimatedElementCount`, metrics.liquidAnimatedElementCount, budgets.liquidAnimatedElementCount, warnings)
    checkMetric(`${prefix} liquidControlPseudoAnimatedElementCount`, metrics.liquidControlPseudoAnimatedElementCount, budgets.liquidControlPseudoAnimatedElementCount, warnings)
    checkMetric(`${prefix} nextErrorOverlayCount`, metrics.nextErrorOverlayCount, budgets.nextErrorOverlayCount, warnings)
    checkMetric(`${prefix} longTaskCount`, pageResult.longTasks.count, budgets.longTaskCount, warnings)
    checkMetric(`${prefix} maxLongTaskMs`, pageResult.longTasks.maxMs, budgets.maxLongTaskMs, warnings)
    checkMetric(`${prefix} totalLongTaskMs`, pageResult.longTasks.totalMs, budgets.totalLongTaskMs, warnings)
  }

  for (const interaction of result.interactions) {
    if (interaction.skipped) continue
    const prefix = `${result.viewport}/${interaction.label}`
    checkMetric(`${prefix} responseMs`, interaction.responseMs, budgets.routeSwitchDurationMs, warnings)
    checkMetric(`${prefix} longTaskCount`, interaction.longTasks.count, budgets.longTaskCount, warnings)
    checkMetric(`${prefix} maxLongTaskMs`, interaction.longTasks.maxMs, budgets.maxLongTaskMs, warnings)
    checkMetric(`${prefix} totalLongTaskMs`, interaction.longTasks.totalMs, budgets.totalLongTaskMs, warnings)
  }

  result.warnings = warnings
}

function printPageSummary(pageResult) {
  const m = pageResult.metrics
  console.log(`  ${pageResult.label}: ${m.pathname}`)
  if (pageResult.routeMismatch) console.log(`    route: expected ${pageResult.expectedPathname}, got ${m.pathname}`)
  console.log(`    nav ${pageResult.wallTimeMs}ms, longTasks ${pageResult.longTasks.count}/${pageResult.longTasks.maxMs}ms max/${pageResult.longTasks.totalMs}ms total`)
  console.log(`    backdrop ${m.visibleBackdropFilterCount} visible (${m.visibleLiquidBackdropFilterCount} liquid), large ${m.largeBackdropFilterCount}, maxArea ${m.maxBackdropAreaRatio}`)
  console.log(`    liquid animated elements ${m.liquidAnimatedElementCount}, control pseudo ${m.liquidControlPseudoAnimatedElementCount}, placeholder pseudo ${m.placeholderPseudoAnimatedElementCount}`)
  console.log(`    timeline dots ${m.timelineDotCount}, dots with backdrop ${m.timelineDotsWithBackdropFilter}, nav buttons ${m.navButtonCount}, nav indicator ${m.navIndicatorCount}, nav svg filters ${m.navSvgFilterCount}`)
  if (m.authRedirected) console.log('    auth: redirected to /login, page-specific metrics are not representative')
}

function printInteractionSummary(interaction) {
  if (interaction.skipped) {
    console.log(`  ${interaction.label}: skipped (${interaction.reason})`)
    return
  }
  console.log(`  ${interaction.label}: response ${interaction.responseMs}ms, settled ${interaction.settledMs}ms, longTasks ${interaction.longTasks.count}/${interaction.longTasks.maxMs}ms max/${interaction.longTasks.totalMs}ms total`)
}

async function auditViewport(options, viewport) {
  const { context, close } = await createBrowserContext(options, viewport)
  const page = context.pages()[0] || await context.newPage()
  page.setDefaultTimeout(options.timeoutMs)

  try {
    if (options.login) await waitForManualLogin(page, options)

    const pages = []
    const interactions = []

    pages.push(await gotoAndMeasure(page, 'home', makeAbsoluteUrl(options.baseUrl, '/home'), options))

    const projectsButton = page.locator('.mkr-liquid-nav-button', { hasText: /Projects|项目/ })
    interactions.push(await measureClickInteraction(
      page,
      'home -> projects nav',
      projectsButton,
      () => page.waitForURL(/\/projects(?:$|[?#])/, { timeout: options.timeoutMs }).catch(() => {}),
      options,
    ))

    pages.push(await gotoAndMeasure(page, 'projects', makeAbsoluteUrl(options.baseUrl, '/projects'), options))

    const exploreButton = page.locator('.mkr-liquid-nav-button', { hasText: /Explore|探索/ })
    interactions.push(await measureClickInteraction(
      page,
      'projects -> home nav',
      exploreButton,
      () => page.waitForURL(/\/home(?:$|[?#])/, { timeout: options.timeoutMs }).catch(() => {}),
      options,
    ))

    const project = projectPath(options)
    if (project) {
      pages.push(await gotoAndMeasure(page, 'project editor', makeAbsoluteUrl(options.baseUrl, project), options))
      const timelineDots = page.locator('.mkr-liquid-timeline-dot')
      const dotCount = await timelineDots.count().catch(() => 0)
      if (dotCount > 1) {
        interactions.push(await measureClickInteraction(
          page,
          'timeline first -> second',
          timelineDots.nth(1),
          null,
          options,
        ))
      } else {
        interactions.push({ label: 'timeline first -> second', skipped: true, reason: `only ${dotCount} timeline dot(s)` })
      }
    }

    const result = {
      viewport: viewport.name,
      pages,
      interactions,
      warnings: [],
    }
    addBudgetWarnings(result, DEFAULT_BUDGETS)
    return result
  } finally {
    await close()
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const specs = viewportSpecs(options.viewports)
  const startedAt = new Date().toISOString()

  const report = {
    startedAt,
    baseUrl: options.baseUrl,
    project: projectPath(options) || null,
    budgets: DEFAULT_BUDGETS,
    viewports: [],
  }

  for (const viewport of specs) {
    console.log(`\nAuditing ${viewport.name} at ${options.baseUrl}`)
    const result = await auditViewport(options, viewport)
    report.viewports.push(result)
    for (const pageResult of result.pages) printPageSummary(pageResult)
    console.log('  interactions:')
    for (const interaction of result.interactions) printInteractionSummary(interaction)
    if (result.warnings.length) {
      console.log('  warnings:')
      for (const warning of result.warnings) console.log(`    - ${warning}`)
    } else {
      console.log('  warnings: none')
    }
  }

  const allWarnings = report.viewports.flatMap((viewport) => viewport.warnings)
  console.log(`\nLiquid Glass audit finished with ${allWarnings.length} warning(s).`)
  if (options.json) console.log(JSON.stringify(report, null, 2))
  if (options.strict && allWarnings.length) process.exitCode = 1
}

main().catch((error) => {
  console.error(error?.stack || error)
  process.exit(1)
})
