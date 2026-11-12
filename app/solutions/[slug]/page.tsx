/** x01 website page: one solution (preview-locked until the switch). */

import { SitePage, siteMetadata } from '@/components/site/SitePage'

export const dynamic = 'force-dynamic'
export const metadata = siteMetadata('solutions')

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  return <SitePage page="solution" slug={slug} />
}
