import type { MetadataRoute } from 'next'
import { SITE_URL } from '@/lib/seo'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: ['/', '/home', '/home/', '/makaron', '/agent', '/use-cases/', '/releases/'],
      disallow: [
        '/admin',
        '/api',
        '/activate',
        '/claim',
        '/dashboard',
        '/demo-3d',
        '/login',
        '/mcp',
        '/moveable-test',
        '/profile',
        '/projects',
        '/skills',
      ],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  }
}
