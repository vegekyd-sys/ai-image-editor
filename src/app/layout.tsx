import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Suspense } from "react";
import AuthProvider from "@/components/AuthProvider";
import MarketingTracker from "@/components/MarketingTracker";
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
            <Suspense fallback={null}>
              <MarketingTracker />
            </Suspense>
            {children}
          </AuthProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
