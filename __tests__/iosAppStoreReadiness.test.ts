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
  });

  it('keeps the native iOS webview locked to app-like viewport behavior', () => {
    expect(config.appId).toBe('app.makaron.ios');
    expect(config.zoomEnabled).toBe(false);
    expect(config.appendUserAgent).toContain('MakaronIOS');
    expect(config.plugins?.Keyboard).toMatchObject({ resize: 'none', style: 'DARK' });
  });

  it('routes Makaron iOS WebView users away from Google OAuth', () => {
    const loginPage = fs.readFileSync(path.join(root, 'src/app/login/page.tsx'), 'utf8');
    expect(loginPage).toContain('userAgentHasMakaronIOSToken');
    expect(loginPage).toContain('{!inApp &&');
  });

  it('tracks the migration acceptance criteria in docs', () => {
    const plan = fs.readFileSync(path.join(root, 'docs/ios-migration-test-plan.md'), 'utf8');
    expect(plan).toContain('Keyboard adaptation');
    expect(plan).toContain('Billing compliance');
    expect(plan).toContain('App Store Review Defaults');
    expect(plan).toContain('StoreKit');
  });

  it('bundles a local fallback shell that forwards to the production web app', () => {
    const shell = fs.readFileSync(path.join(root, 'capacitor-www/index.html'), 'utf8');
    expect(shell).toContain('viewport-fit=cover');
    expect(shell).toContain('SplashScreen');
    expect(shell).toContain('https://www.makaron.app/');
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
  });

  it('keeps native safe-area padding scoped to iOS editor controls instead of the body', () => {
    const globals = fs.readFileSync(path.join(root, 'src/app/globals.css'), 'utf8');
    const editor = fs.readFileSync(path.join(root, 'src/components/Editor.tsx'), 'utf8');
    const projects = fs.readFileSync(path.join(root, 'src/app/projects/page.tsx'), 'utf8');
    const topBar = fs.readFileSync(path.join(root, 'src/components/TopBar.tsx'), 'utf8');
    expect(globals).toContain('.makaron-ios-app body');
    expect(globals).toContain('padding: 0');
    expect(globals).toContain('.makaron-ios-app .makaron-editor-shell');
    expect(globals).toContain('--makaron-ios-bottom-control-inset');
    expect(globals).toContain('.makaron-ios-app .makaron-editor-bottom-bar');
    expect(globals).toContain('.makaron-ios-app .makaron-topbar');
    expect(globals).toContain('.makaron-ios-app .makaron-projects-hero');
    expect(editor).toContain('makaron-editor-shell');
    expect(editor).toContain('makaron-editor-topbar');
    expect(editor).toContain('makaron-editor-bottom-bar');
    expect(projects).toContain('makaron-projects-page');
    expect(projects).toContain('makaron-projects-hero');
    expect(topBar).toContain('makaron-topbar');
  });

  it('routes native keyboard height into the CUI input bar', () => {
    const bootstrap = fs.readFileSync(path.join(root, 'src/components/NativeAppBootstrap.tsx'), 'utf8');
    const chat = fs.readFileSync(path.join(root, 'src/components/AgentChatView.tsx'), 'utf8');
    expect(bootstrap).toContain('makaron-keyboard-inset-change');
    expect(chat).toContain('nativeKbInset');
    expect(chat).toContain('effectiveKbInset');
    expect(chat).toContain('inputBarH + effectiveKbInset');
  });

  it('uses an iOS-only WebView edge gesture to drive SPA history without blocking touches', () => {
    const editor = fs.readFileSync(path.join(root, 'src/components/Editor.tsx'), 'utf8');
    const bootstrap = fs.readFileSync(path.join(root, 'src/components/NativeAppBootstrap.tsx'), 'utf8');
    const bridge = fs.readFileSync(path.join(root, 'ios/App/App/MakaronBridgeViewController.swift'), 'utf8');
    const storyboard = fs.readFileSync(path.join(root, 'ios/App/App/Base.lproj/Main.storyboard'), 'utf8');
    const project = fs.readFileSync(path.join(root, 'ios/App/App.xcodeproj/project.pbxproj'), 'utf8');
    expect(editor).toContain('hasCuiHistoryState');
    expect(editor).toContain("window.addEventListener('popstate', handlePop)");
    expect(editor).toContain("viewMode === 'cui'");
    expect(editor).not.toContain('edgeSwipeBackRef');
    expect(editor).not.toContain('makaron-native-back');
    expect(bootstrap).toContain('installIOSBackSwipe');
    expect(bootstrap).toContain('IOS_BACK_SWIPE_EDGE_PX');
    expect(bootstrap).toContain("document.addEventListener('touchstart'");
    expect(bootstrap).toContain("document.addEventListener('touchmove'");
    expect(bootstrap).toContain('window.history.back()');
    expect(bootstrap).toContain('data-view-mode');
    expect(bootstrap).not.toContain('document.body.style.transform');
    expect(editor).toContain('data-makaron-cui-pan');
    expect(editor).toContain('IOS_CUI_PAN_COMMIT_PX');
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
});
