/** x01 website page: achievements (preview-locked until the switch; see components/site/SitePage.tsx). */

import { SitePage, siteMetadata } from '@/components/site/SitePage'

export const dynamic = 'force-dynamic'
export const metadata = siteMetadata('achievements')

export default function Page() {
  return <SitePage page="achievements" />
}
