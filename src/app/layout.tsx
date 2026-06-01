import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Suspense } from "react";
import AuthProvider from "@/components/AuthProvider";
import NativeAppBootstrap from "@/components/NativeAppBootstrap";
import NativeIOSPageStack from "@/components/NativeIOSPageStack";
import { LocaleProvider } from "@/lib/i18n";
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
  title: "Makaron - one man creative studio",
  description: "AI-powered image editor - chat to edit your photos",
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="bg-black">
      <head>
        <link rel="preconnect" href="https://cdn.makaron.app" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-black`}
      >
        <LocaleProvider>
          <AuthProvider>
            <NativeAppBootstrap />
            <Suspense fallback={<>{children}</>}>
              <NativeIOSPageStack>{children}</NativeIOSPageStack>
            </Suspense>
          </AuthProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
