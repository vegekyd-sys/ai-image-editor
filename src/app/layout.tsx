import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { cookies, headers } from "next/headers";
import { Suspense } from "react";
import AIDataConsentGate, { AI_DATA_CONSENT_COOKIE } from "@/components/AIDataConsentGate";
import AuthProvider from "@/components/AuthProvider";
import NativeAppBootstrap from "@/components/NativeAppBootstrap";
import NativeIOSPageStack from "@/components/NativeIOSPageStack";
import MarketingTracker from "@/components/MarketingTracker";
import MobileAppEventsBootstrap from "@/components/MobileAppEventsBootstrap";
import { LocaleProvider } from "@/lib/i18n";
import { getLocaleConfig } from "@/lib/locales";
import { userAgentHasMakaronIOSToken } from "@/lib/native-app";
import { DEFAULT_DESCRIPTION, DEFAULT_OG_IMAGE, SITE_NAME, SITE_URL } from "@/lib/seo";
import { resolveRequestLocale } from "@/lib/server-locale";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  applicationName: SITE_NAME,
  title: {
    default: "Makaron - AI creative studio for images and video",
    template: `%s | ${SITE_NAME}`,
  },
  description: DEFAULT_DESCRIPTION,
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: "Makaron - AI creative studio for images and video",
    description: DEFAULT_DESCRIPTION,
    url: "/home",
    images: [{ url: DEFAULT_OG_IMAGE }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Makaron - AI creative studio for images and video",
    description: DEFAULT_DESCRIPTION,
    images: [DEFAULT_OG_IMAGE],
  },
  icons: {
    icon: [
      { url: "/favicon.ico" },
      { url: "/brand/makaron-favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/brand/makaron-favicon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/brand/makaron-apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#000000",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  const locale = resolveRequestLocale(
    cookieStore.get('locale')?.value,
    headerStore.get('accept-language'),
  );
  const htmlLang = getLocaleConfig(locale).htmlLang;
  const requiresAIDataConsent = userAgentHasMakaronIOSToken(headerStore.get('user-agent') ?? undefined);
  const hasInitialAIDataConsent = cookieStore.get(AI_DATA_CONSENT_COOKIE)?.value === 'v1';

  return (
    <html lang={htmlLang} className={`${geistSans.variable} ${geistMono.variable} bg-black`}>
      <head>
        <link rel="preconnect" href="https://cdn.makaron.app" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-black`}
      >
        <LocaleProvider initialLocale={locale}>
          <AuthProvider>
            <NativeAppBootstrap />
            <MobileAppEventsBootstrap />
            <Suspense fallback={null}>
              <MarketingTracker />
            </Suspense>
            <AIDataConsentGate
              required={requiresAIDataConsent}
              initiallyAccepted={requiresAIDataConsent && hasInitialAIDataConsent}
            >
              <Suspense fallback={<>{children}</>}>
                <NativeIOSPageStack>{children}</NativeIOSPageStack>
              </Suspense>
            </AIDataConsentGate>
          </AuthProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
