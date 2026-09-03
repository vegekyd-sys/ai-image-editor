import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import config from '../capacitor.config';

const root = path.resolve(__dirname, '..');

describe('iOS App Store readiness guardrails', () => {
  it('uses a bundled launch shell instead of production server.url', () => {
    expect(config.webDir).toBe('capacitor-www');
    expect(config.server?.url).toBeUndefined();
    expect(config.server?.allowNavigation).toContain('www.makaron.app');
    expect(config.server?.allowNavigation).toContain('makaron.app');
    expect(config.server?.allowNavigation).toContain('cdn.makaron.app');
    expect(config.server?.allowNavigation).not.toContain('ai-image-editor-fdi797ko7-vegekyd-sys-projects.vercel.app');
  });

  it('keeps the native iOS webview locked to app-like viewport behavior', () => {
    expect(config.appId).toBe('app.makaron.ios');
    expect(config.zoomEnabled).toBe(false);
    expect(config.appendUserAgent).toContain('MakaronIOS');
    expect(config.plugins?.Keyboard).toMatchObject({ resize: 'none', style: 'DARK' });
  });

  it('keeps Google available in Makaron iOS WebView with Apple as the equivalent App Store login option', () => {
    const loginPage = fs.readFileSync(path.join(root, 'src/app/login/page.tsx'), 'utf8');
    const authCallback = fs.readFileSync(path.join(root, 'src/app/api/auth/callback/route.ts'), 'utf8');
    const authReturn = fs.readFileSync(path.join(root, 'src/lib/auth-return.ts'), 'utf8');
    expect(loginPage).toContain('userAgentHasMakaronIOSToken');
    expect(loginPage).toContain('isMakaronIOSApp');
    expect(loginPage).toContain("const IOS_PENDING_HOME_SKILL_KEY = 'makaron:ios-pending-home-skill-id'");
    expect(loginPage).toContain('resolveReturnUrlForRuntime');
    expect(loginPage).toContain('sessionStorage.setItem(IOS_PENDING_HOME_SKILL_KEY, skillId)');
    expect(loginPage).toContain('resolveAuthReturnPathForRuntime(returnUrl, iosAppRuntime)');
    expect(authReturn).toContain("returnPath: isIOSApp ? '/home'");
    expect(loginPage).toContain('NEXT_PUBLIC_ENABLE_APPLE_LOGIN');
    expect(loginPage).toContain('inApp && appleLoginEnabled');
    expect(loginPage).toContain('const showGoogleOAuth = !inApp || iosApp || showAppleOAuth');
    expect(loginPage).toContain('{showGoogleOAuth && (');
    expect(loginPage).toContain('handleAppleLogin');
    expect(loginPage).toContain("provider: 'apple'");
    expect(loginPage).toContain("provider: 'google'");
    expect(loginPage).toContain('auth.continueWithApple');
    expect(loginPage).toContain('auth.continueWithGoogle');
    expect(authCallback).toContain("(navigator.userAgent||'').indexOf('MakaronIOS')!==-1");
    expect(authCallback).toContain("sessionStorage.setItem('makaron:ios-pending-home-skill-id',skillMatch[1])");
    expect(authCallback).toContain("r='/home'");
    expect(authCallback).toContain("r='/home?skill='+encodeURIComponent(skillMatch[1])");
  });

  it('requires explicit AI data-sharing consent before mounting iOS creative content', () => {
    const layout = fs.readFileSync(path.join(root, 'src/app/layout.tsx'), 'utf8');
    const gate = fs.readFileSync(path.join(root, 'src/components/AIDataConsentGate.tsx'), 'utf8');
    const privacy = fs.readFileSync(path.join(root, 'src/app/privacy/page.tsx'), 'utf8');
    const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20260715000000_hide_app_review_sensitive_skills.sql'), 'utf8');

    expect(layout).toContain('userAgentHasMakaronIOSToken');
    expect(layout).toContain('initiallyAccepted={requiresAIDataConsent && hasInitialAIDataConsent}');
    expect(layout).toContain("cookieStore.get(AI_DATA_CONSENT_COOKIE)?.value === 'v1'");
    expect(gate).toContain("'makaron:ai-data-consent:v1'");
    expect(gate).toContain("setState('declined')");
    expect(gate).toContain("AI_DATA_CONSENT_COOKIE = 'makaron_ai_data_consent'");
    expect(gate).toContain('`${AI_DATA_CONSENT_COOKIE}=v1; path=/');
    expect(gate).toContain("window.location.replace('/home')");
    expect(privacy).toContain('Before the Makaron iOS app sends your content');
    expect(privacy).toContain('Google (Gemini)');
    expect(privacy).toContain('same or equivalent privacy and security protection');
    expect(migration).toContain("'34bd54e7-8b2e-49f6-a746-d8658ab63fd5'");
    expect(migration).toContain("'00f126ac-7451-4ee6-8025-e67dcc7b0169'");
  });

  it('tracks the migration acceptance criteria in docs', () => {
    const plan = fs.readFileSync(path.join(root, 'docs/ios-migration-test-plan.md'), 'utf8');
    expect(plan).toContain('Keyboard adaptation');
    expect(plan).toContain('Billing compliance');
    expect(plan).toContain('App Store Review Defaults');
    expect(plan).toContain('StoreKit');
  });

  it('bundles a remote launch shell that makes iOS black screens diagnosable', () => {
    const shell = fs.readFileSync(path.join(root, 'capacitor-www/index.html'), 'utf8');
    expect(shell).toContain('viewport-fit=cover');
    expect(shell).toContain('SplashScreen');
    expect(shell).toContain('Opening Makaron');
    expect(shell).toContain('https://www.makaron.app/home');
    expect(shell).not.toContain('ai-image-editor-fdi797ko7-vegekyd-sys-projects.vercel.app');
    expect(shell).toContain('Cannot reach Makaron');
  });

  it('declares iOS permission purpose strings and portrait-only full-screen orientation', () => {
    const infoPlist = fs.readFileSync(path.join(root, 'ios/App/App/Info.plist'), 'utf8');
    expect(infoPlist).toContain('NSCameraUsageDescription');
    expect(infoPlist).toContain('NSPhotoLibraryUsageDescription');
    expect(infoPlist).toContain('NSPhotoLibraryAddUsageDescription');
    expect(infoPlist).toContain('NSMicrophoneUsageDescription');
    expect(infoPlist).toContain('NSAllowsLocalNetworking');
    expect(infoPlist).toContain('ITSAppUsesNonExemptEncryption');
    expect(infoPlist).toContain('UIRequiresFullScreen');
    expect(infoPlist).toContain('UIApplicationSceneManifest');
    expect(infoPlist).toContain('SceneDelegate');
    expect(infoPlist).not.toContain('UIInterfaceOrientationLandscapeLeft');
    expect(infoPlist).not.toContain('UIInterfaceOrientationLandscapeRight');
  });

  it('keeps local iPhone debug routing explicit and resettable', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const helper = fs.readFileSync(path.join(root, 'tools/ios-local-config.mjs'), 'utf8');
    expect(packageJson.scripts['dev:ios']).toContain('-H 0.0.0.0');
    expect(packageJson.scripts['ios:local']).toContain('ios-local-config');
    expect(packageJson.scripts['ios:prod']).toContain('--reset');
    expect(helper).toContain('IOS_DEV_SERVER_URL');
    expect(helper).toContain('delete config.server.url');
    expect(helper).toMatch(/if \(args\.includes\('--reset'\)\)[\s\S]*config\.server\.errorPath = 'index\.html'/);
    expect(helper).toMatch(/config\.server\.url = parsed[\s\S]*delete config\.server\.errorPath/);
  });

  it('keeps native safe-area padding scoped to iOS editor controls instead of the body', () => {
    const globals = fs.readFileSync(path.join(root, 'src/app/globals.css'), 'utf8');
    const layout = fs.readFileSync(path.join(root, 'src/app/layout.tsx'), 'utf8');
    const editor = fs.readFileSync(path.join(root, 'src/components/Editor.tsx'), 'utf8');
    const projects = fs.readFileSync(path.join(root, 'src/app/projects/page.tsx'), 'utf8');
    const topBar = fs.readFileSync(path.join(root, 'src/components/TopBar.tsx'), 'utf8');
    const changelog = fs.readFileSync(path.join(root, 'src/components/Changelog.tsx'), 'utf8');
    expect(globals).toContain('.makaron-ios-app body');
    expect(globals).toContain('padding: 0');
    expect(globals).toContain('.makaron-ios-app .makaron-ios-page');
    expect(globals).toContain('.makaron-ios-app .makaron-editor-shell');
    expect(globals).toContain('--makaron-ios-bottom-control-inset');
    expect(globals).toContain('.makaron-ios-app .makaron-editor-bottom-bar');
    expect(globals).toContain('.makaron-ios-app .makaron-topbar');
    expect(globals).toContain('.makaron-ios-app .makaron-projects-hero');
    expect(globals).toContain('.makaron-ios-app .makaron-ios-stack-entry');
    expect(layout).toContain('NativeIOSPageStack');
    expect(editor).toContain('makaron-editor-shell');
    expect(editor).toContain('makaron-editor-topbar');
    expect(editor).toContain('makaron-editor-bottom-bar');
    expect(projects).toContain('makaron-projects-page');
    expect(projects).toContain('makaron-projects-hero');
    expect(projects).not.toContain('makaron-ios-projects-snapshot-html');
    expect(topBar).toContain('makaron-topbar');
    expect(changelog).toContain('makaron-ios-app');
    expect(changelog).toContain('iOSAppTopGap');
    expect(changelog).toContain('iOSAppBottomGap');
    expect(changelog).toContain('paddingTop: iOSAppTopGap');
    expect(changelog).toContain('paddingBottom: iOSAppBottomGap');
    expect(changelog).toContain('maxHeight: isIOSApp ? `calc(100dvh - ${iOSAppTopGap} - ${iOSAppBottomGap})` : undefined');
  });

  it('gives secondary iOS app pages safe top space and a normal edge-back gesture', () => {
    const bootstrap = fs.readFileSync(path.join(root, 'src/components/NativeAppBootstrap.tsx'), 'utf8');
    const dashboard = fs.readFileSync(path.join(root, 'src/app/dashboard/page.tsx'), 'utf8');
    const skills = fs.readFileSync(path.join(root, 'src/app/skills/page.tsx'), 'utf8');
    const profile = fs.readFileSync(path.join(root, 'src/app/profile/page.tsx'), 'utf8');
    const admin = fs.readFileSync(path.join(root, 'src/app/admin/page.tsx'), 'utf8');
    const adminStatus = fs.readFileSync(path.join(root, 'src/app/admin/status/page.tsx'), 'utf8');
    const demo3d = fs.readFileSync(path.join(root, 'src/app/demo-3d/page.tsx'), 'utf8');
    const videoRelease = fs.readFileSync(path.join(root, 'src/app/releases/video-in-timeline/page.tsx'), 'utf8');
    const agentContent = fs.readFileSync(path.join(root, 'src/components/AgentContent.tsx'), 'utf8');
    const claim = fs.readFileSync(path.join(root, 'src/app/claim/page.tsx'), 'utf8');
    const mcp = fs.readFileSync(path.join(root, 'src/app/mcp/page.tsx'), 'utf8');
    const skillShare = fs.readFileSync(path.join(root, 'src/app/s/[code]/page.tsx'), 'utf8');
    const login = fs.readFileSync(path.join(root, 'src/app/login/page.tsx'), 'utf8');
    const projects = fs.readFileSync(path.join(root, 'src/app/projects/page.tsx'), 'utf8');
    const home = fs.readFileSync(path.join(root, 'src/app/home/page.tsx'), 'utf8');
    const editor = fs.readFileSync(path.join(root, 'src/components/Editor.tsx'), 'utf8');
    const topBar = fs.readFileSync(path.join(root, 'src/components/TopBar.tsx'), 'utf8');
    const liquidGlassNav = fs.readFileSync(path.join(root, 'src/components/LiquidGlassNav.tsx'), 'utf8');
    const creditPopup = fs.readFileSync(path.join(root, 'src/components/CreditPopup.tsx'), 'utf8');
    const authProvider = fs.readFileSync(path.join(root, 'src/components/AuthProvider.tsx'), 'utf8');
    const nativeCache = fs.readFileSync(path.join(root, 'src/lib/native-app-cache.ts'), 'utf8');
    const nativeNavigation = fs.readFileSync(path.join(root, 'src/lib/native-navigation.ts'), 'utf8');
    const nativePageStack = fs.readFileSync(path.join(root, 'src/lib/native-page-stack.ts'), 'utf8');
    const pageStack = fs.readFileSync(path.join(root, 'src/components/NativeIOSPageStack.tsx'), 'utf8');
    const nativePhotoPicker = fs.readFileSync(path.join(root, 'src/lib/native-photo-picker.ts'), 'utf8');
    const projectsListWarm = fs.readFileSync(path.join(root, 'src/lib/projects-list-warm.ts'), 'utf8');
    const projectEditorCache = fs.readFileSync(path.join(root, 'src/lib/project-editor-cache.ts'), 'utf8');
    const imageCache = fs.readFileSync(path.join(root, 'src/lib/imageCache.ts'), 'utf8');

    expect(bootstrap).toContain('IOS_PAGE_BACK_EDGE_PX');
    expect(bootstrap).toContain('IOS_PAGE_BACK_COMMIT_PX');
    expect(bootstrap).toContain('shouldUsePageBackGesture');
    expect(bootstrap).toContain('setPageBackOffset(dx)');
    expect(bootstrap).toContain("document.querySelector('.makaron-ios-page')");
    expect(bootstrap).toContain('translate3d(${offset}px, 0, 0)');
    expect(bootstrap).toContain("path === '/projects'");
    expect(bootstrap).toContain("path === '/home'");
    expect(bootstrap).toContain("document.querySelector('.makaron-editor-shell')");
    expect(bootstrap).toContain("document.querySelector('[data-makaron-ios-project-overlay]')");
    expect(bootstrap).toContain("document.querySelector('[data-makaron-cui-pan]')");
    expect(bootstrap).toContain('window.history.back()');
    expect(bootstrap).toContain('NATIVE_APP_PREFETCH_ROUTES');
    expect(bootstrap).toContain("'/dashboard'");
    expect(bootstrap).toContain("'/skills'");
    expect(bootstrap).toContain('router.prefetch(route)');
    expect(bootstrap).toContain('NATIVE_APP_WARM_API_PATHS');
    expect(bootstrap).toContain("'/api/billing/dashboard'");
    expect(bootstrap).toContain('warmNativeJSONCache(path)');
    expect(dashboard).toContain("readNativeJSONCache<DashboardPayload>('/api/billing/dashboard')");
    expect(dashboard).toContain("writeNativeJSONCache('/api/billing/dashboard', data)");
    expect(dashboard).toContain('if (!cachedDashboard) setLoading(true)');
    expect(dashboard).not.toContain("useEffect(() => {\n    setLoading(true)\n    fetchDashboard().finally(() => setLoading(false))");
    expect(skills).toContain("readNativeJSONCache<SkillsPayload>('/api/skills')");
    expect(skills).toContain("writeNativeJSONCache('/api/skills', data)");
    expect(nativeCache).toContain('window.sessionStorage');
    expect(nativeCache).toContain('localStorage');
    expect(nativeCache).toContain("getStorage('local')");
    expect(nativeCache).toContain('removeNativeJSONCache');
    expect(authProvider).toContain("const AUTH_USER_CACHE_KEY = '/auth/user'");
    expect(authProvider).toContain('isMakaronIOSApp');
    expect(authProvider).toContain('const useNativeAuthCacheRef = useRef(false)');
    expect(authProvider).not.toContain('useState(() => isMakaronIOSApp())');
    expect(authProvider).toContain('const cachedUser = useNativeAuthCache');
    expect(authProvider).toContain('readNativeJSONCache<User>(AUTH_USER_CACHE_KEY)');
    expect(authProvider).toContain('writeNativeJSONCache(AUTH_USER_CACHE_KEY, session.user)');
    expect(authProvider).toContain('removeNativeJSONCache(AUTH_USER_CACHE_KEY)');
    expect(authProvider).toContain('warmNativeUserCaches');
    expect(authProvider).toContain("warmNativeJSONCache('/api/billing/credits')");
    expect(authProvider).toContain("warmNativeJSONCache('/api/billing/dashboard')");
    expect(authProvider).toContain("warmNativeJSONCache('/api/skills')");
    expect(authProvider).toContain("warmNativeJSONCache('/api/home-skills')");
    expect(authProvider).toContain('warmProjectsListCache(userId)');
    expect(authProvider).toContain("sessionStorage.setItem(IOS_RESET_HOME_SCROLL_KEY, '1')");
    expect(authProvider).toContain("document.documentElement.classList.remove('makaron-ios-project-overlay-open')");
    expect(authProvider).toContain("window.location.replace('/home')");
    expect(topBar).toContain("readNativeJSONCache<CreditsPayload>('/api/billing/credits')");
    expect(topBar).toContain("writeNativeJSONCache('/api/billing/credits', d)");
    expect(topBar).toContain('authReturnPath?: string | null');
    expect(topBar).toContain("localStorage.setItem('mkr_return_url', authReturnPath)");
    expect(topBar).toContain("sessionStorage.setItem('mkr_return_url', authReturnPath)");
    expect(topBar).toContain('TOPBAR_ROUTE_WARM_APIS');
    expect(topBar).toContain('isPrimaryTopBarRoute');
    expect(topBar).toContain('if (!isPrimaryTopBarRoute(path))');
    expect(topBar).toContain('requestNativePageStackPush(path)');
    expect(nativeNavigation).toContain('requestNativePageStackBack(fallbackPath');
    expect(nativePageStack).toContain('NATIVE_PAGE_STACK_PUSH_EVENT');
    expect(nativePageStack).toContain('NATIVE_PAGE_STACK_BACK_EVENT');
    expect(nativePageStack).toContain('isNativeIOSAppRuntime');
    expect(nativePageStack).toContain('document.documentElement.dataset.nativePlatform');
    expect(pageStack).toContain('PendingPageShell');
    expect(pageStack).toContain('FrozenPage');
    expect(pageStack).toContain('sanitizeFrozenHTMLForIOSStack');
    expect(pageStack).toContain("querySelectorAll('video, audio')");
    expect(pageStack).toContain('data-makaron-ios-frozen-media');
    expect(pageStack).toContain("querySelectorAll('script, iframe')");
    expect(pageStack).toContain('useSearchParams');
    expect(pageStack).toContain("const path = `${pathname || '/'}${search ? `?${search}` : ''}`");
    expect(pageStack).toContain('fallbackPath={fallbackPath}');
    expect(pageStack).toContain('entriesRef.current');
    expect(pageStack).toContain('data-makaron-ios-page-stack-back-button');
    expect(pageStack).toContain('data-makaron-ios-stack-entry');
    expect(pageStack).toContain('data-makaron-ios-stack-frozen');
    expect(pageStack).toContain('window.history.back()');
    expect(dashboard).toContain('onClick={handleBackToApp}');
    expect(topBar).toContain('scheduleTopBarWarm');
    expect(topBar).toContain('warmTopBarMenuRoutes');
    expect(topBar).toContain("['/profile', '/dashboard', '/dashboard?tab=keys', '/skills'].forEach(warmTopBarRoute)");
    expect(topBar).toContain('router.push(path)');
    expect(liquidGlassNav).toContain("type PrimarySurface = 'explore' | 'projects'");
    expect(liquidGlassNav).toContain("surface === 'explore' ? '/home' : '/projects'");
    expect(liquidGlassNav).toContain("sessionStorage.setItem(IOS_RESET_HOME_SCROLL_KEY, '1')");
    expect(liquidGlassNav).toContain("touchAction: 'manipulation'");
    expect(liquidGlassNav).toContain('event.preventDefault()');
    expect(liquidGlassNav).toContain('router.push(path)');
    expect(liquidGlassNav).not.toContain('window.requestAnimationFrame(() => router.push(path))');
    expect(liquidGlassNav).toContain('onTouchStart={() => warmRoute(item.value)}');
    expect(topBar).toContain("requestIdleCallback(warm, { timeout: 1600 })");
    expect(topBar).toContain('window.setTimeout(warm, 240)');
    expect(topBar).not.toContain('window.setTimeout(() => warmTopBarRoute(path), 0)');
    const navigateTopBarStart = topBar.indexOf('const navigateTopBar');
    expect(topBar.indexOf('router.push(path)', navigateTopBarStart)).toBeLessThan(topBar.indexOf('scheduleTopBarWarm(path)', navigateTopBarStart));
    expect(topBar).toContain('if (!userMenuOpen) return');
    expect(topBar).toContain('warmTopBarMenuRoutes()');
    expect(topBar).toContain("aria-label={t('nav.openDashboard')}");
    expect(topBar).toContain("aria-label={t('nav.openAccountMenu')}");
    expect(topBar).toContain('data-makaron-user-menu-trigger');
    expect(topBar).toContain('minWidth: 44');
    expect(topBar).toContain('minHeight: 44');
    expect(topBar).toContain("onClick={() => navigateTopBar('/dashboard')}");
    expect(topBar).not.toContain('onPointerDown={warmTopBarMenuRoutes}');
    expect(topBar).not.toContain("onPointerDown={() => scheduleTopBarWarm('/dashboard')}");
    expect(topBar).not.toContain("onPointerDown={() => scheduleTopBarWarm('/projects')}");
    expect(topBar).not.toContain("onPointerDown={() => scheduleTopBarWarm('/home')}");
    expect(topBar).not.toContain("onPointerDown={() => warmTopBarRoute('/dashboard')}");
    expect(topBar).not.toContain("onPointerDown={() => warmTopBarRoute('/projects')}");
    expect(topBar).not.toContain("onPointerDown={() => warmTopBarRoute('/home')}");
    expect(topBar).not.toContain("onPointerDown={() => warmTopBarRoute('/skills')}");
    expect(editor).toContain("readNativeJSONCache<CreditsPayload>('/api/billing/credits')");
    expect(editor).toContain("readNativeJSONCache<SkillsPayload>('/api/skills')");
    expect(editor).toContain("writeNativeJSONCache('/api/skills', d)");
    expect(home).toContain("readNativeJSONCache<HomeSkill[]>('/api/home-skills')");
    expect(home).toContain("readNativeJSONCache<SkillsPayload>('/api/skills')");
    expect(home).toContain("writeNativeJSONCache('/api/home-skills', data)");
    expect(home).toContain('data-makaron-home-fixed-composer');
    expect(home).toContain('const syncFixedInputVisibility = useCallback');
    expect(home).toContain("window.addEventListener('pageshow', scheduleResumeSync)");
    expect(home).toContain("window.addEventListener('focus', scheduleResumeSync)");
    expect(home).toContain("document.addEventListener('visibilitychange', handleVisibilityChange)");
    expect(home).toContain("window.addEventListener('makaron-ios-page-stack-back', scheduleResumeSync as EventListener)");
    expect(home).toContain("window.visualViewport?.addEventListener('scroll', scheduleSync)");
    expect(home).toContain('const refreshHomeComposerViewport = useCallback');
    expect(home).toContain('const fixedComposerViewportInset = getHomeComposerViewportInset({');
    expect(home).toContain('textareaFocused,');
    expect(home).toContain('keyboardInset: effectiveKbInset,');
    expect(home).toContain("bottom: fixedComposerBottom");
    expect(home).toContain("max(env(safe-area-inset-bottom, 0px), ${fixedComposerViewportInset}px)");
    expect(home).toContain('const updateViewportInset = useCallback');
    expect(home).toContain('const effectiveKbInset = Math.max(kbInset, nativeKbInset)');
    expect(home).toContain("window.addEventListener('makaron-keyboard-inset-change', onNativeInset)");
    expect(home).toContain('const blurHomeComposers = useCallback');
    expect(home).toContain('inlineTextareaRef.current?.blur()');
    expect(home).toContain('setKbInset(0)');
    expect(home).toContain("const showAgentLanding = showGuestModeToggle && viewMode === 'agent' && !hasSelectedDetail");
    expect(home).toContain("setViewMode('human')");
    expect(home).toContain('detailCloseTimerRef');
    expect(home).toContain('const clearDetailCloseTimer = useCallback');
    expect(home).toContain('window.clearTimeout(detailCloseTimerRef.current)');
    expect(home).toContain('clearDetailCloseTimer()');
    expect(home).toContain("transform: (showFixedInput || selectedDetail) ? 'translateY(0)' : 'translateY(calc(100% + 20px))'");
    expect(home).toContain("isIOSAppShell && showFixedInput && !selectedDetail ? { opacity: 0, pointerEvents: 'none' as const } : {}");
    expect(home).not.toContain('const focusFixedComposer = useCallback');
    expect(home).not.toContain('textareaRef.current?.focus({ preventScroll: true })');
    expect(projects).toContain("readNativeJSONCache<CreditsPayload>('/api/billing/credits')");
    expect(projects).toContain("readNativeJSONCache<SkillsPayload>('/api/skills')");
    expect(projectsListWarm).toContain('warmProjectsListCache');
    expect(projectsListWarm).toContain('cacheProjectsList(userId, projects)');
    expect(imageCache).toContain('PROJECTS_LIST_LOCAL_KEY');
    expect(imageCache).toContain('localStorage.setItem(PROJECTS_LIST_LOCAL_KEY');
    expect(topBar).toContain('warmProjectsListCache(user.id)');
    expect(creditPopup).toContain("writeNativeJSONCache('/api/billing/credits', data)");
    expect(projectEditorCache).toContain('warmProjectEditorCache');
    expect(projectEditorCache).toContain('cacheProjectData');
    expect(projects).toContain('warmProjectEditorCaches(projects.map((project) => project.id), userId, 6)');
    expect(projects).toContain('onTouchStart={onWarm}');
    expect(projects).toContain('onPointerEnter={onWarm}');
    expect(bootstrap).toContain('pickMediaItemsFromNativePhotoLibrary');
    expect(bootstrap).toContain('acceptsNativePhotoPicker');
    expect(bootstrap).toContain('acceptsNativeMediaPickerAccept(input.accept)');
    expect(bootstrap).toContain('nativePickerAllowsVideo(input.accept)');
    expect(bootstrap).toContain('multiple: input.multiple');
    expect(bootstrap).toContain('pickedFiles.forEach((file) => files.items.add(file))');
    expect(bootstrap).toContain('getIOSPageBackBackdropRoute');
    expect(bootstrap).toContain('document.createElement(\'iframe\')');
    expect(bootstrap).toContain('showPageBackBackdrop(true)');
    expect(bootstrap).toContain('showPageBackBackdrop(false)');
    expect(bootstrap).toContain('makaron-ios-warm-page-backdrop');
    expect(bootstrap).toContain('schedulePageBackBackdropWarm()');
    expect(bootstrap).toContain('hidePageBackBackdrop()');
    expect(bootstrap).toContain('IOS_LAST_PRIMARY_ROUTE_KEY');
    expect(topBar).toContain('sessionStorage.setItem(IOS_LAST_PRIMARY_ROUTE_KEY, currentPath)');
    expect(topBar).toContain("window.dispatchEvent(new Event('makaron-ios-warm-page-backdrop'))");
    expect(nativePhotoPicker).toContain("normalized.includes('video/')");
    expect(nativePhotoPicker).toContain("normalized.includes('.heic')");
    expect(bootstrap).toContain("input.dispatchEvent(new Event('change'");
    expect(bootstrap).not.toContain('document.body.style.transform');
    expect(bootstrap).not.toContain('cloneNode');
    expect(nativeNavigation).toContain('navigateBackInIOSApp');
    expect(nativeNavigation).toContain('isMakaronIOSApp');
    expect(nativeNavigation).toContain('env.history');
    expect(nativeNavigation).toContain('history.back()');
    expect(nativeNavigation).toContain('location.assign(fallbackPath)');
    expect(dashboard).toContain('navigateBackInIOSApp');
    expect(skills).toContain('navigateBackInIOSApp');
    expect(profile).toContain('navigateBackInIOSApp');
    expect(dashboard).toContain('handleBackToApp');
    expect(skills).toContain('handleBackToApp');
    expect(profile).toContain('handleBackToApp');
    expect(admin).toContain('navigateBackInIOSApp');
    expect(admin).toContain('handleBackToApp');
    expect(dashboard).toContain('makaron-ios-page');
    expect(skills).toContain('makaron-ios-page');
    expect(profile).toContain('makaron-ios-page');
    expect(admin).toContain('makaron-ios-page');
    expect(dashboard).toContain('makaron-ios-page makaron-ios-page-x');
    expect(profile).toContain('makaron-ios-page makaron-ios-page-x');
    expect(admin).toContain('makaron-ios-page makaron-ios-page-x');
    expect(dashboard).not.toContain('makaron-ios-page min-h-dvh bg-black text-white p-6 max-w-2xl mx-auto');
    expect(profile).not.toContain('makaron-ios-page min-h-dvh bg-black text-white p-6 max-w-lg mx-auto');
    expect(admin).not.toContain('makaron-ios-page min-h-dvh bg-black text-white p-6 max-w-2xl mx-auto');
    expect(agentContent).not.toContain('makaron-ios-page makaron-ios-page-x min-h-screen w-full bg-black text-gray-200 font-mono p-6 md:p-12 max-w-4xl mx-auto');
    expect(dashboard).toContain('<div className="max-w-2xl mx-auto">');
    expect(profile).toContain('<div className="max-w-lg mx-auto">');
    expect(admin).toContain("<div className={`mx-auto ${tab === 'billing' ? 'max-w-6xl' : 'max-w-2xl'}`}>");
    expect(agentContent).toContain('<div className="max-w-4xl mx-auto">');
    expect(adminStatus).toContain('makaron-ios-page');
    expect(demo3d).toContain('makaron-ios-page');
    expect(videoRelease).toContain('makaron-ios-page');
    expect(agentContent).toContain('makaron-ios-page');
    expect(claim).toContain('makaron-ios-page');
    expect(mcp).toContain('makaron-ios-page');
    expect(skillShare).toContain('makaron-ios-page');
    expect(login).toContain('makaron-ios-page');
  });

  it('keeps the iOS in-app route surface covered by app-shell guardrails', () => {
    const appShellRoutes = [
      { route: '/dashboard', file: 'src/app/dashboard/page.tsx', required: ['makaron-ios-page', 'navigateBackInIOSApp', "readNativeJSONCache<DashboardPayload>('/api/billing/dashboard')"] },
      { route: '/profile', file: 'src/app/profile/page.tsx', required: ['makaron-ios-page', 'navigateBackInIOSApp'] },
      { route: '/skills', file: 'src/app/skills/page.tsx', required: ['makaron-ios-page', 'navigateBackInIOSApp', "readNativeJSONCache<SkillsPayload>('/api/skills')"] },
      { route: '/admin', file: 'src/app/admin/page.tsx', required: ['makaron-ios-page', 'navigateBackInIOSApp'] },
      { route: '/admin/status', file: 'src/app/admin/status/page.tsx', required: ['makaron-ios-page'] },
      { route: '/demo-3d', file: 'src/app/demo-3d/page.tsx', required: ['makaron-ios-page'] },
      { route: '/releases/video-in-timeline', file: 'src/app/releases/video-in-timeline/page.tsx', required: ['makaron-ios-page'] },
      { route: '/claim', file: 'src/app/claim/page.tsx', required: ['makaron-ios-page'] },
      { route: '/mcp', file: 'src/app/mcp/page.tsx', required: ['makaron-ios-page'] },
      { route: '/s/[code]', file: 'src/app/s/[code]/page.tsx', required: ['makaron-ios-page'] },
      { route: '/login', file: 'src/app/login/page.tsx', required: ['makaron-ios-page', 'userAgentHasMakaronIOSToken'] },
      { route: '/landingpage', file: 'src/app/landingpage/page.tsx', required: ['makaron-ios-page'] },
      { route: '/moveable-test', file: 'src/app/moveable-test/page.tsx', required: ['makaron-ios-page'] },
    ];

    for (const page of appShellRoutes) {
      const source = fs.readFileSync(path.join(root, page.file), 'utf8');
      for (const token of page.required) {
        expect(source, `${page.route} should include ${token}`).toContain(token);
      }
      expect(source, `${page.route} should not use body transform back hacks`).not.toContain('document.body.style.transform');
      expect(source, `${page.route} should not clone page snapshots for back gestures`).not.toContain('cloneNode');
    }

    const home = fs.readFileSync(path.join(root, 'src/app/home/page.tsx'), 'utf8');
    const projects = fs.readFileSync(path.join(root, 'src/app/projects/page.tsx'), 'utf8');
    const projectPage = fs.readFileSync(path.join(root, 'src/app/projects/[id]/page.tsx'), 'utf8');
    const agentContent = fs.readFileSync(path.join(root, 'src/components/AgentContent.tsx'), 'utf8');
    const editor = fs.readFileSync(path.join(root, 'src/components/Editor.tsx'), 'utf8');

    expect(home).toContain('handleSkillBackPanStart');
    expect(home).toContain('readNativeJSONCache<HomeSkill[]>');
    expect(projects).toContain('data-makaron-ios-project-overlay');
    expect(projects).toContain('warmProjectEditorCaches');
    expect(projectPage).toContain('ProjectEditorContainer');
    expect(agentContent).toContain('makaron-ios-page');
    expect(editor).toContain('makaron-editor-shell');
    expect(editor).toContain('data-makaron-cui-pan');
  });

  it('keeps every current app page classified for iOS app-shell coverage', () => {
    const appDir = path.join(root, 'src/app');
    const pages: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name === 'page.tsx') pages.push(path.relative(root, full));
      }
    };
    walk(appDir);

    const shellCovered = new Set([
      'src/app/admin/page.tsx',
      'src/app/admin/status/page.tsx',
      'src/app/claim/page.tsx',
      'src/app/dashboard/page.tsx',
      'src/app/demo-3d/page.tsx',
      'src/app/landingpage/page.tsx',
      'src/app/login/page.tsx',
      'src/app/mcp/page.tsx',
      'src/app/moveable-test/page.tsx',
      'src/app/privacy/page.tsx',
      'src/app/profile/page.tsx',
      'src/app/releases/video-in-timeline/page.tsx',
      'src/app/s/[code]/page.tsx',
      'src/app/skills/page.tsx',
      'src/app/support/page.tsx',
    ]);
    const handledByComposition = new Set([
      'src/app/agent/page.tsx',
      'src/app/home/page.tsx',
      'src/app/makaron/page.tsx',
      'src/app/projects/page.tsx',
      'src/app/projects/[id]/page.tsx',
      'src/app/skill/[skillId]/page.tsx',
      'src/app/use-cases/page.tsx',
      'src/app/use-cases/[slug]/page.tsx',
    ]);
    const redirectsOnly = new Set([
      'src/app/page.tsx',
      'src/app/home/[skillId]/page.tsx',
    ]);

    expect([...shellCovered, ...handledByComposition, ...redirectsOnly].sort()).toEqual([...pages].sort());

    for (const file of shellCovered) {
      const source = fs.readFileSync(path.join(root, file), 'utf8');
      expect(source, `${file} should include iOS page shell`).toContain('makaron-ios-page');
      expect(source, `${file} should include horizontal safe-area shell`).toContain('makaron-ios-page-x');
      const shellLines = source.split('\n').filter((line) => line.includes('makaron-ios-page'));
      for (const line of shellLines) {
        expect(line, `${file} must not constrain the iOS shell width`).not.toMatch(/\b(max-w-|mx-auto)\b/);
      }
    }
    expect(fs.readFileSync(path.join(root, 'src/app/agent/page.tsx'), 'utf8')).toContain('AgentContent');
    expect(fs.readFileSync(path.join(root, 'src/app/home/page.tsx'), 'utf8')).toContain('AgentContent');
    expect(fs.readFileSync(path.join(root, 'src/app/projects/page.tsx'), 'utf8')).toContain('data-makaron-ios-project-overlay');
    expect(fs.readFileSync(path.join(root, 'src/app/projects/[id]/page.tsx'), 'utf8')).toContain('ProjectEditorContainer');
    for (const file of redirectsOnly) {
      expect(fs.readFileSync(path.join(root, file), 'utf8'), `${file} should be redirect-only`).toContain('redirect(');
    }
  });

  it('saves editor images and videos through native Photos on iOS before web fallbacks', () => {
    const bridge = fs.readFileSync(path.join(root, 'ios/App/App/MakaronBridgeViewController.swift'), 'utf8');
    const plist = fs.readFileSync(path.join(root, 'ios/App/App/Info.plist'), 'utf8');
    const nativeMedia = fs.readFileSync(path.join(root, 'src/lib/native-media.ts'), 'utf8');
    const download = fs.readFileSync(path.join(root, 'src/lib/editor/download.ts'), 'utf8');

    expect(plist).toContain('NSPhotoLibraryAddUsageDescription');
    expect(plist).toContain('NSPhotoLibraryUsageDescription');
    expect(plist).toContain('NSCameraUsageDescription');
    expect(plist).toContain('NSMicrophoneUsageDescription');
    expect(plist).toContain('NSAllowsLocalNetworking');
    expect(bridge).toContain('WKScriptMessageHandler');
    expect(bridge).toContain('PHPickerViewControllerDelegate');
    expect(bridge).toContain('PHPhotoLibrary');
    expect(bridge).toContain('PHPickerViewController');
    expect(bridge).toContain('PHPhotoLibrary.authorizationStatus(for: .addOnly)');
    expect(bridge).toContain('PHPhotoLibrary.requestAuthorization(for: .addOnly)');
    expect(bridge).toContain('PHPickerConfiguration(photoLibrary: .shared())');
    expect(bridge).toContain('makaronNative');
    expect(bridge).toContain('saveToPhotos');
    expect(bridge).toContain('pickMedia');
    expect(bridge).toContain('configuration.preferredAssetRepresentationMode = .compatible');
    expect(bridge).toContain('normalizedPickedImagePayload');
    expect(bridge).toContain('configuration.selectionLimit = allowsMultiple ? 0 : 1');
    expect(bridge).toContain('resizedPickedImage(image, maxDimension: 2048)');
    expect(bridge).toContain('jpegData(compressionQuality: 0.9)');
    expect(bridge).toContain('return (jpegData, jpegFilename(for: filename), "image/jpeg")');
    expect(bridge).toContain('PHAssetCreationRequest.forAsset()');
    expect(bridge).toContain('UIImage(data: data)');
    expect(bridge).toContain('jpegData(compressionQuality: 0.95)');
    expect(bridge).toContain('jpegFilename(for: filename)');
    expect(bridge).toContain('placeholderForCreatedAsset?.localIdentifier');
    expect(bridge).toContain('[Makaron] native save request');
    expect(bridge).toContain('[Makaron] native save image result');
    expect(bridge).toContain('[Makaron] native response');
    expect(bridge).toContain("window.dispatchEvent(new CustomEvent('makaron-native-response'");
    expect(nativeMedia).toContain('isNativePhotoLibrarySaveAvailable');
    expect(nativeMedia).toContain('isNativePhotoLibraryPickerAvailable');
    expect(nativeMedia).toContain('saveBlobToNativePhotoLibrary');
    expect(nativeMedia).toContain('saveUrlToNativePhotoLibrary');
    expect(nativeMedia).toContain('pickMediaFromNativePhotoLibrary');
    expect(nativeMedia).toContain('pickMediaItemsFromNativePhotoLibrary');
    expect(nativeMedia).toContain('makaron:native-media:last-result');
    expect(nativeMedia).toContain("phase: 'sent'");
    expect(nativeMedia).toContain("phase: 'timeout'");
    expect(nativeMedia).toContain('IMAGE_SAVE_TIMEOUT_MS');
    expect(nativeMedia).toContain('webkit?.messageHandlers?.makaronNative');
    expect(download).toContain('isNativePhotoLibrarySaveAvailable');
    expect(download).toContain('normalizeImageBlobForNativeSave');
    expect(download).toContain('isRemoteHttpUrl(img)');
    expect(download).toContain('saveUrlToNativePhotoLibrary(img');
    expect(download).toContain("setAgentStatus('Saving to Photos...')");
    expect(download).toContain("setAgentStatus('Native save failed, trying fallback...')");
    expect(download).toContain('Save failed:');
    expect(download).toContain("canvas.toBlob((result) =>");
    expect(download).toContain("'image/png'");
    expect(download).toContain('preserves any decoded alpha');
    expect(download).toContain('saveBlobToNativePhotoLibrary');
    expect(download).toContain('saveUrlToNativePhotoLibrary');
  });

  it('routes native keyboard height into the CUI input bar', () => {
    const bootstrap = fs.readFileSync(path.join(root, 'src/components/NativeAppBootstrap.tsx'), 'utf8');
    const chat = fs.readFileSync(path.join(root, 'src/components/AgentChatView.tsx'), 'utf8');
    expect(bootstrap).toContain('makaron-keyboard-inset-change');
    expect(bootstrap).toContain('nativeKeyboardInset');
    expect(bootstrap).toContain('viewportKeyboardInset');
    expect(bootstrap).toContain('Math.max(nativeKeyboardInset, viewportKeyboardInset)');
    expect(bootstrap).toContain('keyboardWillShow');
    expect(bootstrap).toContain('keyboardDidShow');
    expect(bootstrap).toContain('keyboardWillHide');
    expect(bootstrap).toContain('keyboardDidHide');
    expect(chat).toContain('nativeKbInset');
    expect(chat).toContain('effectiveKbInset');
    expect(chat).toContain('keyboardInsetCss');
    expect(chat).toContain('var(--makaron-native-keyboard-inset');
    expect(chat).toContain('calc(${inputBarH}px + ${keyboardInsetCss})');
    expect(chat).toContain("className={isPanel ? 'flex-shrink-0 px-3' : 'fixed left-0 right-0 px-3'}");
    expect(chat).toContain('keepInputAboveKeyboard');
    expect(chat).toContain('onFocus={keepInputAboveKeyboard}');
    expect(chat).toContain("scrollIntoView({ block: 'end', inline: 'nearest' })");
  });

  it('keeps iOS home skill detail back swipe scoped to the skill overlay', () => {
    const homePage = fs.readFileSync(path.join(root, 'src/app/home/page.tsx'), 'utf8');
    const homeSkillMedia = fs.readFileSync(path.join(root, 'src/components/HomeSkillMedia.tsx'), 'utf8');
    expect(homePage).toContain('isMakaronIOSApp');
    expect(homePage).toContain('usePathname');
    expect(homePage).toContain('const isIOSAppShell = hydrated && isMakaronIOSApp()');
    expect(homePage).not.toContain('useState(() => isMakaronIOSApp())');
    expect(homePage).toContain('detailPathActiveRef');
    expect(homePage).toContain('IOS_SKILL_BACK_EDGE_PX');
    expect(homePage).toContain('IOS_SKILL_BACK_COMMIT_PX');
    expect(homePage).toContain('closeSkillDetail');
    expect(homePage).toContain('handleSkillBackPanStart');
    expect(homePage).toContain('handleSkillBackPanMove');
    expect(homePage).toContain('handleSkillBackPanEnd');
    expect(homePage).toContain('onTouchStartCapture={handleSkillBackPanStart}');
    expect(homePage).toContain('onTouchMoveCapture={handleSkillBackPanMove}');
    expect(homePage).toContain('onTouchEndCapture={handleSkillBackPanEnd}');
    expect(homePage).toContain("window.addEventListener('popstate', onPop)");
    expect(homePage).toContain('writeSkillDetailPath(template.id, \'push\')');
    expect(homePage).toContain('writeSkillDetailPath(t.id, \'replace\')');
    expect(homePage).toContain("const url = isIOSAppShell ? '/home' : `/home?skill=${encodeURIComponent(skillId)}`");
    expect(homePage).toContain('IOS_PENDING_HOME_SKILL_KEY');
    expect(homePage).toContain('rememberIOSSkillReturn');
    expect(homePage).toContain("const skillId = new URLSearchParams(window.location.search).get('skill') || pathSkillId || pendingIOSSkillId");
    expect(homePage).not.toContain('useSearchParams');
    expect(homePage).toContain('draft.images.length < getRequiredHomeSkillImageCount(homeSkill)');
    expect(homePage).toContain("document.documentElement.style.overflow = 'hidden'");
    expect(homePage).toContain("window.addEventListener('makaron-ios-page-stack-back', unlockIfNoDetail)");
    expect(homeSkillMedia).toContain('function SkillVideo');
    expect(homePage).toContain("slide.getAttribute('data-skill-id') === selectedDetail.id");
    expect(homePage).not.toContain('document.body.style.transform');
    expect(homePage).not.toContain('cloneNode');
    expect(homePage).not.toContain('data-makaron-ios-project-overlay');
  });

  it('keeps iOS project navigation inside a live projects-page overlay while preserving CUI pan close', () => {
    const editor = fs.readFileSync(path.join(root, 'src/components/Editor.tsx'), 'utf8');
    const bootstrap = fs.readFileSync(path.join(root, 'src/components/NativeAppBootstrap.tsx'), 'utf8');
    const projectsPage = fs.readFileSync(path.join(root, 'src/app/projects/page.tsx'), 'utf8');
    const projectPage = fs.readFileSync(path.join(root, 'src/app/projects/[id]/page.tsx'), 'utf8');
    const projectContainer = fs.readFileSync(path.join(root, 'src/components/ProjectEditorContainer.tsx'), 'utf8');
    const imageCache = fs.readFileSync(path.join(root, 'src/lib/imageCache.ts'), 'utf8');
    const storage = fs.readFileSync(path.join(root, 'src/lib/supabase/storage.ts'), 'utf8');
    const globals = fs.readFileSync(path.join(root, 'src/app/globals.css'), 'utf8');
    const bridge = fs.readFileSync(path.join(root, 'ios/App/App/MakaronBridgeViewController.swift'), 'utf8');
    const storyboard = fs.readFileSync(path.join(root, 'ios/App/App/Base.lproj/Main.storyboard'), 'utf8');
    const project = fs.readFileSync(path.join(root, 'ios/App/App.xcodeproj/project.pbxproj'), 'utf8');
    const projectLoading = path.join(root, 'src/app/projects/[id]/loading.tsx');
    expect(projectContainer).toContain('getPendingProjectLaunchSync(projectId)');
    expect(projectContainer).toContain('if (isNewProject && user)');
    expect(projectContainer).toContain('.maybeSingle()');
    expect(editor).toContain('hasCuiHistoryState');
    expect(editor).toContain("window.addEventListener('popstate', handlePop)");
    expect(editor).toContain("viewMode === 'cui'");
    expect(editor).toContain('disableAgentLiveReload');
    expect(editor).toContain('window.clearTimeout(reloadTimer)');
    expect(editor).toContain('disableBodyScrollLock');
    expect(editor).toContain('inactive?: boolean');
    expect(editor).toContain('inactive = false');
    expect(editor).toContain('if (inactive) return');
    expect(editor).not.toContain('edgeSwipeBackRef');
    expect(editor).not.toContain('makaron-native-back');
    expect(bootstrap).not.toContain('installIOSBackSwipe');
    expect(bootstrap).not.toContain('IOS_BACK_SWIPE_EDGE_PX');
    expect(bootstrap).not.toContain('document.body.style.transform');
    expect(bootstrap).toContain('__makaronNativeBootId');
    expect(bootstrap).toContain('NATIVE_BOOT_LOG_SESSION_KEY');
    expect(bootstrap).toContain('[makaron-ios-native] boot');
    expect(projectsPage).toContain('data-makaron-ios-project-overlay');
    expect(projectsPage).toContain('activeIOSProjectId');
    expect(projectsPage).toContain('renderedIOSProjectId');
    expect(projectsPage).toContain('renderedIOSProjectIdRef');
    expect(projectsPage).toContain('projectsRef');
    expect(projectsPage).toContain('const currentProjects = projectsRef.current');
    expect(projectsPage).toContain('loadingProjectsRef');
    expect(projectsPage).toContain('needsInitialProjects');
    expect(projectsPage).toContain('duringFrozenReturn');
    expect(projectsPage).toContain('docHeight');
    expect(projectsPage).toContain('hasHiddenEditor');
    expect(projectsPage).toContain('editor-retained-hidden-after-return');
    expect(projectsPage).not.toContain('IOS_PROJECT_EDITOR_UNMOUNT_DELAY_MS');
    expect(projectsPage).not.toContain('iosProjectUnmountTimerRef');
    expect(projectsPage).not.toContain('clearIOSProjectUnmountTimer');
    expect(projectsPage).not.toContain('editor-hidden-after-return');
    expect(projectsPage).not.toContain('editor-unmounted-after-return');
    expect(projectsPage).not.toContain('setRenderedIOSProjectId(null)');
    expect(projectsPage).toContain('iosProjectScrollYRef');
    expect(projectsPage).toContain('pendingIOSProjectsRefreshRef');
    expect(projectsPage).toContain('iosProjectNavGenerationRef');
    expect(projectsPage).toContain('projects-fetch-discarded-nav-generation-changed');
    expect(projectsPage).toContain('refreshIOSProjectCard');
    expect(projectsPage).toContain('project-card-refreshed-after-return');
    expect(projectsPage).toContain('projects-background-refresh-requested');
    expect(projectsPage).toContain('projects-stashed-refresh-applied');
    expect(projectsPage).toContain('projectsRefreshNonce');
    expect(projectsPage).toContain('iosProjectRefreshSelfTest');
    expect(projectsPage).toContain('refresh-self-test-pass');
    expect(projectsPage).toContain('data-snapshot-count');
    expect(projectsPage).toContain('iosReturnSelfTest');
    expect(projectsPage).toContain('return-self-test-pass');
    expect(projectsPage).toContain('iosProjectClosingRef');
    expect(projectsPage).toContain('close-project-ignored-already-closing');
    expect(projectsPage).toContain('IOS_PROJECT_RETURN_REFRESH_GUARD_MS');
    expect(projectsPage).toContain('IOS_PROJECT_AUTH_GRACE_MS');
    expect(projectsPage).toContain('iosProjectReturnFreezeUntilRef');
    expect(projectsPage).toContain('iosProjectAuthGraceUntilRef');
    expect(projectsPage).toContain('canHoldIOSProjectsDuringAuthGap');
    expect(projectsPage).toContain('canHoldCachedIOSProjectsWithoutUser');
    expect(projectsPage).toContain('auth-gap-held-after-return');
    expect(projectsPage).toContain('auth-empty-held-with-cached-projects');
    expect(projectsPage).toContain('applyProjectsRefresh');
    expect(projectsPage).not.toContain('retainedProjectId: renderedIOSProjectIdRef.current');
    expect(projectsPage).not.toContain('|| renderedIOSProjectIdRef.current');
    expect(projectsPage).not.toContain('iosProjectsPageFrozen');
    expect(projectsPage).not.toContain('iosProjectReturnFrozen');
    expect(projectsPage).not.toContain('data-makaron-ios-project-freeze-spacer');
    expect(projectsPage).not.toContain("top: `-${iosProjectScrollYRef.current}px`");
    expect(projectsPage).not.toContain("position: 'fixed' as const");
    expect(projectsPage).toContain("visibility: activeIOSProjectId ? 'visible' : 'hidden'");
    expect(projectsPage).toContain("contentVisibility: activeIOSProjectId ? 'visible' : 'hidden'");
    expect(projectsPage).toContain("pointerEvents: activeIOSProjectId ? 'auto' : 'none'");
    expect(projectsPage).toContain("contain: 'layout paint'");
    expect(projectsPage).not.toContain("contain: 'layout paint style'");
    expect(projectsPage).toContain("isolation: 'isolate'");
    expect(projectsPage).toContain('blockNativeBackSwipe');
    expect(projectsPage).toContain('passive: false');
    expect(projectsPage).toContain("overscrollBehaviorX: 'contain'");
    expect(projectsPage).toContain('isMakaronIOSAppShell');
    expect(projectsPage).toContain('.Capacitor');
    expect(projectsPage).toContain('getLastProjectsListSync');
    expect(projectsPage).toContain('canRenderCachedIOSProjectsWhileAuthPending');
    expect(projectsPage).toContain('(authLoading || canHoldIOSProjectsDuringAuthGap || canHoldCachedIOSProjectsWithoutUser)');
    expect(projectsPage).toContain('__makaronIOSProjectNavLog');
    expect(projectsPage).toContain('IOS_PROJECT_NAV_LOG_SESSION_KEY');
    expect(projectsPage).toContain('[ios-project-nav]');
    expect(projectsPage).toContain('const [iosAppShell, setIosAppShell] = useState(false)');
    expect(projectsPage).not.toContain('useState(() => isMakaronIOSAppShell())');
    expect(projectsPage).toContain('useIOSInlineProjectNavigation');
    expect(projectsPage).not.toContain('useSearchParams');
    expect(projectsPage).not.toContain("searchParams.get('iosProject')");
    expect(projectsPage).not.toContain('open-project-from-route-handoff');
    expect(projectsPage).not.toContain('iosProjectParam');
    expect(projectsPage).not.toContain('?iosProject=');
    expect(projectsPage).toContain('useInlineNavigation');
    expect(projectsPage).toContain('role="link"');
    expect(projectsPage).toContain('isCuiOpen');
    expect(projectsPage).not.toContain('makaronProjectOverlay');
    expect(projectsPage).not.toContain("window.addEventListener('popstate'");
    expect(projectsPage).not.toContain('window.history.back()');
    expect(projectsPage).not.toContain('document.body.style.overflow');
    expect(projectsPage).not.toContain('document.body.style.position');
    expect(projectsPage).not.toContain('window.location.reload');
    expect(projectsPage).not.toContain('`/projects/${projectId}`');
    expect(projectsPage).not.toContain("router.push('/projects')");
    expect(projectsPage).not.toContain("router.replace('/projects')");
    expect(projectsPage).toContain("import { createPortal } from 'react-dom'");
    expect(projectsPage).toContain('createPortal((');
    expect(projectsPage).toContain('document.body)');
    expect(projectsPage).toContain("document.documentElement.classList.add('makaron-ios-project-overlay-open')");
    expect(projectsPage).toContain("document.documentElement.classList.remove('makaron-ios-project-overlay-open')");
    expect(globals).toContain('html.makaron-ios-project-overlay-open');
    expect(projectsPage).toContain('ProjectEditorContainer');
    expect(projectsPage).toContain('disableAgentLiveReload');
    expect(projectsPage).toContain('disableBodyScrollLock');
    expect(projectsPage).toContain('isInlineActive={activeIOSProjectId === renderedIOSProjectId}');
    expect(projectsPage).toContain('if (useIOSInlineProjectNavigation)');
    expect(projectsPage).toContain('openIOSProject(result.projectId)');
    expect(projectsPage).toContain('useIOSSafeImageUrls={useIOSInlineProjectNavigation}');
    expect(projectsPage).toContain('getOriginFormatThumbnailUrl(coverUrl, 400, 50, 400)');
    expect(storage).toContain("'format=origin'");
    expect(projectsPage).toContain('useIOSSafeImageUrls ? imageSrc ?? null : null');
    expect(projectsPage).toContain('const shouldAnimateIn = !useIOSSafeImageUrls && index < 12');
    expect(projectsPage).toContain('animationDelay: shouldAnimateIn ?');
    expect(projectsPage).toContain("className={shouldAnimateIn ? 'mkr-card mkr-row-enter' : 'mkr-card'}");
    expect(projectsPage).toContain("transition: useIOSSafeImageUrls ? 'none'");
    expect(projectsPage).toContain('loading={index < 4 ?');
    expect(projectsPage).toContain('decoding="async"');
    expect(bootstrap).not.toContain('makaron-ios-projects-snapshot-html');
    expect(projectsPage).not.toContain('makaron-ios-projects-snapshot-html');
    expect(bootstrap).not.toContain('data-makaron-ios-back-overlay');
    expect(projectsPage).not.toContain('data-makaron-ios-back-overlay');
    expect(bootstrap).not.toContain('cloneNode');
    expect(projectsPage).not.toContain('cloneNode');
    expect(bootstrap).not.toContain('makaron-ios-project-back');
    expect(editor).toContain('data-makaron-cui-pan');
    expect(editor).toContain('IOS_CUI_PAN_COMMIT_PX');
    expect(editor).not.toContain('shouldPlayIOSProjectPush');
    expect(editor).not.toContain('data-makaron-ios-projects-backdrop');
    expect(projectPage).toContain('ProjectEditorContainer');
    expect(projectPage).not.toContain('isMakaronIOSApp');
    expect(projectPage).not.toContain('shouldHandoffIOSProjectRouteToOverlay');
    expect(projectPage).not.toContain('handoff-route-to-overlay');
    expect(projectPage).not.toContain('router.replace(`/projects?iosProject=');
    expect(projectPage).not.toContain('?iosProject=');
    expect(projectPage).not.toContain('IOS_PROJECT_BACK_EVENT');
    expect(projectContainer).toContain('getCachedProjectDataSync');
    expect(projectContainer).toContain('onProjectCreated');
    expect(projectContainer).toContain('disableAgentLiveReload');
    expect(projectContainer).toContain('disableBodyScrollLock');
    expect(projectContainer).toContain('isInlineActive?: boolean');
    expect(projectContainer).toContain('if (!isInlineActive) return');
    expect(projectContainer).toContain('inactive={!isInlineActive}');
    expect(projectContainer).toContain('makaron-editor-topbar');
    expect(projectContainer).toContain('makaron-editor-loading-shimmer');
    expect(projectContainer).toContain('min-h-[78px]');
    expect(projectContainer).not.toContain('Loading project');
    expect(projectContainer).toContain('const leaveEditor = useCallback');
    expect(projectContainer).toContain('if (onBack)');
    expect(projectContainer).toContain('onBack()');
    expect(projectContainer).toContain('if (navigatingRef.current) return');
    expect(projectContainer).not.toContain('updateCover');
    expect(imageCache).toContain('PROJECTS_LIST_SESSION_KEY');
    expect(imageCache).toContain('getLastProjectsListSync');
    expect(imageCache).toContain('sessionStorage.setItem(PROJECTS_LIST_SESSION_KEY');
    expect(imageCache).toContain('sessionStorage.removeItem(PROJECTS_LIST_SESSION_KEY');
    expect(fs.existsSync(projectLoading)).toBe(false);
    expect(bridge).not.toContain('interactiveBackEdgeView');
    expect(bridge).not.toContain('UIPanGestureRecognizer');
    expect(bridge).toContain('allowsBackForwardNavigationGestures = false');
    expect(bridge).toContain('contentInsetAdjustmentBehavior = .never');
    expect(bridge).not.toContain('dispatchNativeBackEvent');
    expect(storyboard).toContain('MakaronBridgeViewController');
    expect(project).toContain('MakaronBridgeViewController.swift in Sources');
    expect(project).toContain('SceneDelegate.swift in Sources');
  });

  it('bundles a privacy manifest with required UserDefaults reason', () => {
    const privacy = fs.readFileSync(path.join(root, 'ios/App/App/PrivacyInfo.xcprivacy'), 'utf8');
    const project = fs.readFileSync(path.join(root, 'ios/App/App.xcodeproj/project.pbxproj'), 'utf8');
    expect(privacy).toContain('NSPrivacyAccessedAPICategoryUserDefaults');
    expect(privacy).toContain('CA92.1');
    expect(privacy).toContain('NSPrivacyTracking');
    expect(project).toContain('PrivacyInfo.xcprivacy in Resources');
  });

  it('routes iOS marketing events to first-party storage and native attribution without loading Pixel', () => {
    const tracker = fs.readFileSync(path.join(root, 'src/components/MarketingTracker.tsx'), 'utf8');
    const pixel = fs.readFileSync(path.join(root, 'src/lib/marketing/meta-pixel.ts'), 'utf8');
    const capi = fs.readFileSync(path.join(root, 'src/lib/marketing/meta-capi.ts'), 'utf8');

    expect(tracker).toContain('isMakaronIOSApp');
    expect(tracker).toContain('nativeApp === null');
    expect(tracker).toContain('nativeApp !== false');
    expect(pixel).toContain("eventSource: nativeApp ? 'ios_app' : 'browser'");
    expect(pixel).toContain('trackMobileAppEvent');
    expect(pixel).toContain('if (nativeApp) return');
    expect(capi).toContain('MAKARON_IOS_USER_AGENT_TOKEN');
    expect(capi).toContain('user-agent');
  });
});
