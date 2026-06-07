import type { Metadata } from 'next'

export const SITE_NAME = 'Makaron'
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ||
  process.env.NEXT_PUBLIC_APP_URL ||
  'https://www.makaron.app'

export const DEFAULT_OG_IMAGE = '/landing/desktop-screenshot.jpg'

export const DEFAULT_DESCRIPTION =
  'Makaron is an AI creative studio for editing photos, generating videos, making posters, and turning images into social content by chatting with an AI agent.'

export function absoluteUrl(path = '/') {
  if (/^https?:\/\//i.test(path)) return path
  return new URL(path, SITE_URL).toString()
}

export function pageTitle(title: string) {
  return `${title} | ${SITE_NAME}`
}

export function buildPublicMetadata({
  title,
  description = DEFAULT_DESCRIPTION,
  path,
  image = DEFAULT_OG_IMAGE,
  keywords = [],
}: {
  title: string
  description?: string
  path: string
  image?: string
  keywords?: string[]
}): Metadata {
  const fullTitle = title.includes(SITE_NAME) ? title : pageTitle(title)
  const canonical = absoluteUrl(path)
  const imageUrl = absoluteUrl(image)

  return {
    title: fullTitle,
    description,
    keywords: [
      'Makaron',
      'AI image editor',
      'AI photo editor',
      'AI creative studio',
      'chat to edit photos',
      ...keywords,
    ],
    alternates: {
      canonical,
    },
    openGraph: {
      type: 'website',
      siteName: SITE_NAME,
      title: fullTitle,
      description,
      url: canonical,
      images: [{ url: imageUrl }],
    },
    twitter: {
      card: 'summary_large_image',
      title: fullTitle,
      description,
      images: [imageUrl],
    },
  }
}

export const noIndexMetadata: Metadata = {
  robots: {
    index: false,
    follow: false,
    googleBot: {
      index: false,
      follow: false,
    },
  },
}
