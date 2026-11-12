/** x01 website page: one achievement / project (preview-locked until the switch). */

import { SitePage, siteGenerateMetadata } from '@/components/site/SitePage'

export const dynamic = 'force-dynamic'
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const p = await params
  return siteGenerateMetadata('achievement', undefined, p.id)
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <SitePage page="achievement" id={id} />
}
