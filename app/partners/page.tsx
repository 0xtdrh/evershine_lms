/** x01 website page: partners (preview-locked until the switch; see components/site/SitePage.tsx). */

import { SitePage, siteMetadata } from '@/components/site/SitePage'

export const dynamic = 'force-dynamic'
export const metadata = siteMetadata('partners')

export default function Page() {
  return <SitePage page="partners" />
}
