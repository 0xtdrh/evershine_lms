/** Six phases 1-a: one course / track page on the website (preview-locked until the switch). */

import { SitePage } from '@/components/site/SitePage'
import { publicCatalog } from '@/lib/site/courses-store'
import { SITE_LIVE, siteUrl } from '@/lib/site/pages'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const c = (await publicCatalog({ slug }))[0]
  const title = c ? `${c.title.ar} | TechNova` : 'TechNova'
  const description = (c?.summary.ar || '').slice(0, 300)
  return {
    title: { absolute: title }, description, alternates: { canonical: `${siteUrl()}/courses/${slug}` },
    openGraph: { type: 'website', siteName: 'TechNova', locale: 'ar_EG', title, description, url: `${siteUrl()}/courses/${slug}`, images: [{ url: c?.imageUrl || `${siteUrl()}/brand/bglogo.png` }] },
    robots: SITE_LIVE ? { index: true, follow: true } : { index: false, follow: false },
  }
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  return <SitePage page="course" slug={slug} />
}
