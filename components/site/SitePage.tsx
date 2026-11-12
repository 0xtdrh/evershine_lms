/**
 * x01: renders one website page on the server — the preview lock (localhost = anyone, a real domain = admins only, else
 * 404), the content, the real items and the live numbers. Every website route is a few lines that call this.
 */

import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { auth } from '@/lib/auth'
import { siteStats } from '@/lib/site/stats'
import { getSiteContent } from '@/lib/site/content-store'
import { publicItems } from '@/lib/site/items-store'
import { canOpenSitePreview } from '@/lib/site/preview-access'
import { PAGE_TITLE, slugify, type SitePage as Page } from '@/lib/site/pages'
import { siteFontClass } from '@/lib/site/fonts'
import SiteHome from './SiteHome'

export function siteMetadata(page: Page, title?: string): Metadata {
  const t = title ?? (page in PAGE_TITLE ? `${PAGE_TITLE[page as keyof typeof PAGE_TITLE].en} — TechNova` : 'TechNova — We teach technology and we build it')
  return { title: { absolute: t }, robots: { index: false, follow: false } }
}

export async function SitePage({ page, slug, id }: { page: Page; slug?: string; id?: string }) {
  const host = (await headers()).get('host')
  const session = await auth()
  if (!canOpenSitePreview(host, session?.user?.role)) notFound()
  const [stats, content, items] = await Promise.all([siteStats(), getSiteContent(), publicItems()])
  let detail: { solution?: (typeof content.solutions.items)[number]; item?: (typeof items)[number] } | undefined
  if (page === 'solution') {
    const solution = content.solutions.items.find((s) => s.show !== false && slugify(s.title.en) === slug)
    if (!solution) notFound()
    detail = { solution }
  }
  if (page === 'achievement') {
    const item = items.find((i) => i.kind === 'ACHIEVEMENT' && i.id === id)
    if (!item) notFound()
    detail = { item }
  }
  return <SiteHome content={content} items={items} stats={stats} preview page={page} detail={detail} fontClass={siteFontClass} />
}
