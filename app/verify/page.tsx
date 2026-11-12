/** x01 website page: verify (preview-locked until the switch; see components/site/SitePage.tsx). */

import { SitePage, siteMetadata } from '@/components/site/SitePage'

export const dynamic = 'force-dynamic'
export const metadata = siteMetadata('verify')

export default function Page() {
  return <SitePage page="verify" />
}
