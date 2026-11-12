/** x01 website page: one solution (preview-locked until the switch). */

import { SitePage, siteGenerateMetadata } from '@/components/site/SitePage'

export const dynamic = 'force-dynamic'
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const p = await params
  return siteGenerateMetadata('solution', p.slug)
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  return <SitePage page="solution" slug={slug} />
}
