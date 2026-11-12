/** robots.txt (x01): the public website is open to search engines; the system, APIs and private pages are not. */

import type { MetadataRoute } from 'next'
import { siteUrl } from '@/lib/site/pages'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/dashboard', '/api/', '/login', '/change-password', '/reset-password', '/forgot-password', '/setup-2fa', '/receipts/', '/reports/', '/topups/', '/wallet-statement/', '/card/', '/passport/', '/profile/', '/new-home'] }],
    sitemap: `${siteUrl()}/sitemap.xml`,
  }
}
