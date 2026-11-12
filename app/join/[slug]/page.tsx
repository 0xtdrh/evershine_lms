/** Six phases 1-a: the website sign-up steps for one course page (preview-locked until the switch). */

import { SitePage } from '@/components/site/SitePage'
import { publicCatalog } from '@/lib/site/courses-store'
import { siteUrl } from '@/lib/site/pages'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const c = (await publicCatalog({ slug }))[0]
  const title = c ? `التسجيل في ${c.title.ar} | TechNova` : 'TechNova'
  return { title: { absolute: title }, alternates: { canonical: `${siteUrl()}/join/${slug}` }, robots: { index: false, follow: false } }
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  return <SitePage page="join" slug={slug} />
}
