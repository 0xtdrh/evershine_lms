/** x01 campaign page /c/<slug> (one ad / offer). Ended → the home page; hidden or unknown → not found. */

import { SitePage } from '@/components/site/SitePage'
import { campaignBySlug } from '@/lib/site/campaigns-store'
import { SITE_LIVE, siteUrl } from '@/lib/site/pages'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const c = await campaignBySlug(slug)
  const title = c ? `${c.title.ar} | TechNova` : 'TechNova'
  const description = (c?.offer.ar || c?.text.ar || '').slice(0, 300)
  return {
    title: { absolute: title }, description,
    openGraph: { type: 'website', siteName: 'TechNova', locale: 'ar_EG', title, description, url: `${siteUrl()}/c/${slug}`, images: [{ url: c?.imageUrl || `${siteUrl()}/brand/bglogo.png` }] },
    robots: SITE_LIVE ? { index: true, follow: true } : { index: false, follow: false },
  }
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  return <SitePage page="campaign" slug={slug} />
}
