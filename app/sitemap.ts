/** sitemap.xml (x01): the website's pages. While the new site is a preview only the current home page and policies. */

import type { MetadataRoute } from 'next'
import { PAGE_PATH, SITE_LIVE, siteUrl, slugify } from '@/lib/site/pages'
import { getSiteContent } from '@/lib/site/content-store'
import { publicItems } from '@/lib/site/items-store'

export const dynamic = 'force-dynamic'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl()
  const now = new Date()
  const out: MetadataRoute.Sitemap = [
    { url: `${base}/`, lastModified: now, changeFrequency: 'weekly', priority: 1 },
    { url: `${base}/policies`, lastModified: now, changeFrequency: 'monthly', priority: 0.3 },
  ]
  if (!SITE_LIVE) return out
  for (const k of ['education', 'solutions', 'products', 'achievements', 'media', 'partners', 'about', 'verify']) {
    out.push({ url: `${base}${PAGE_PATH[k]}`, lastModified: now, changeFrequency: 'weekly', priority: 0.8 })
  }
  const [content, items] = await Promise.all([getSiteContent(), publicItems()])
  for (const s of content.solutions.items.filter((x) => x.show !== false)) out.push({ url: `${base}/solutions/${slugify(s.title.en)}`, lastModified: now, changeFrequency: 'monthly', priority: 0.7 })
  for (const i of items.filter((x) => x.kind === 'ACHIEVEMENT')) out.push({ url: `${base}/achievements/${i.id}`, lastModified: now, changeFrequency: 'monthly', priority: 0.5 })
  return out
}
