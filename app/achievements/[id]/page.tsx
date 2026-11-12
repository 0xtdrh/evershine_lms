/** x01 website page: one achievement / project (preview-locked until the switch). */

import { SitePage, siteMetadata } from '@/components/site/SitePage'

export const dynamic = 'force-dynamic'
export const metadata = siteMetadata('achievements')

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <SitePage page="achievement" id={id} />
}
