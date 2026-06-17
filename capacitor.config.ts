import type { CapacitorConfig } from '@capacitor/cli';
import { KeyboardResize, KeyboardStyle } from '@capacitor/keyboard';
import { Style } from '@capacitor/status-bar';

const config: CapacitorConfig = {
  appId: 'app.makaron.ios',
  appName: 'Makaron',
  webDir: 'capacitor-www',
  backgroundColor: '#000000',
  zoomEnabled: false,
  appendUserAgent: ' MakaronIOS',
  ios: {
    path: 'ios',
    scheme: 'Makaron',
    contentInset: 'never',
  },
  server: {
    iosScheme: 'capacitor',
    allowNavigation: [
      'www.makaron.app',
      'makaron.app',
      'cdn.makaron.app',
      'ai-image-editor-o5g5vq7ad-vegekyd-sys-projects.vercel.app',
    ],
    errorPath: 'index.html',
  },
  plugins: {
    Keyboard: {
      resize: KeyboardResize.None,
      style: KeyboardStyle.Dark,
      resizeOnFullScreen: false,
    },
    SplashScreen: {
      launchAutoHide: true,
      launchShowDuration: 500,
      backgroundColor: '#000000',
      showSpinner: false,
    },
    StatusBar: {
      style: Style.Dark,
      backgroundColor: '#000000',
      overlaysWebView: true,
    },
  },
};

export default config;
