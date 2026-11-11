/**
 * x01 — preview of the new TechNova home page. Hidden until the owner approves it: only a signed-in Super Admin / Admin can
 * open it (everyone else gets 404), and search engines are told not to index it. The current home page (app/page.tsx) is
 * not touched.
 */

import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { IBM_Plex_Sans_Arabic, Space_Grotesk } from 'next/font/google'
import { auth } from '@/lib/auth'
import { siteStats } from '@/lib/site/stats'
import SiteHome from '@/components/site/SiteHome'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: { absolute: 'TechNova — We teach technology and we build it' },
  robots: { index: false, follow: false },
}

const ar = IBM_Plex_Sans_Arabic({ subsets: ['arabic', 'latin'], weight: ['400', '600', '700'], variable: '--font-tn-ar', display: 'swap' })
const en = Space_Grotesk({ subsets: ['latin'], weight: ['500', '700'], variable: '--font-tn-en', display: 'swap' })

export default async function NewHomePreview() {
  const session = await auth()
  const role = session?.user?.role
  if (role !== 'SUPER_ADMIN' && role !== 'ADMIN') notFound()
  const stats = await siteStats()
  return <SiteHome stats={stats} preview fontClass={`${ar.variable} ${en.variable}`} />
}
