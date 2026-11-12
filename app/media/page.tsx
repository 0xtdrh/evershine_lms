/** x01 website page: media (preview-locked until the switch; see components/site/SitePage.tsx). */

import { SitePage, siteMetadata } from '@/components/site/SitePage'

export const dynamic = 'force-dynamic'
export const metadata = siteMetadata('media')

export default function Page() {
  return <SitePage page="media" />
}
