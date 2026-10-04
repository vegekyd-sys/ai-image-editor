import type { MetadataRoute } from 'next'
import { SITE_URL } from '@/lib/seo'

export default function robots(): MetadataRoute.Robots {
  const publicAgentPaths = [
    '/llms.txt',
    '/skill.md',
    '/.well-known/agent-skills/',
    '/agent',
    '/mcp',
  ]

  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', ...publicAgentPaths, '/home', '/home/', '/makaron', '/privacy', '/support', '/skill/', '/use-cases/', '/releases/'],
        disallow: [
          '/admin',
          '/api',
          '/activate',
          '/claim',
          '/dashboard',
          '/demo-3d',
          '/login',
          '/moveable-test',
          '/profile',
          '/projects',
          '/skills',
        ],
      },
      {
        userAgent: 'OAI-SearchBot',
        allow: ['/', ...publicAgentPaths, '/use-cases/', '/skill/'],
        disallow: ['/admin', '/api', '/dashboard', '/login', '/profile', '/projects'],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  }
}
