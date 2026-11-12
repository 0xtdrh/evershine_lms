/**
 * x01 — preview of the new TechNova home page, until the owner approves it. On the owner's own computer (localhost)
 * anyone can open it; on a real domain only a signed-in Super Admin / Admin (everyone else gets 404). Search engines are
 * told not to index it. The current home page (app/page.tsx) is not touched.
 */

import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { IBM_Plex_Sans_Arabic, Space_Grotesk } from 'next/font/google'
import { auth } from '@/lib/auth'
import { siteStats } from '@/lib/site/stats'
import { getSiteContent } from '@/lib/site/content-store'
import { publicItems } from '@/lib/site/items-store'
import { canOpenSitePreview } from '@/lib/site/preview-access'
import SiteHome from '@/components/site/SiteHome'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: { absolute: 'TechNova — We teach technology and we build it' },
  robots: { index: false, follow: false },
}

const ar = IBM_Plex_Sans_Arabic({ subsets: ['arabic', 'latin'], weight: ['400', '600', '700'], variable: '--font-tn-ar', display: 'swap' })
const en = Space_Grotesk({ subsets: ['latin'], weight: ['500', '700'], variable: '--font-tn-en', display: 'swap' })

export default async function NewHomePreview() {
  const host = (await headers()).get('host')
  const session = await auth()
  if (!canOpenSitePreview(host, session?.user?.role)) notFound()
  const [stats, content, items] = await Promise.all([siteStats(), getSiteContent(), publicItems()])
  return <SiteHome content={content} items={items} stats={stats} preview fontClass={`${ar.variable} ${en.variable}`} />
}
