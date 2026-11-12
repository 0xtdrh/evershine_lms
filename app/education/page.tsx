/** x01 website page: education (preview-locked until the switch; see components/site/SitePage.tsx). */

import { SitePage, siteMetadata } from '@/components/site/SitePage'

export const dynamic = 'force-dynamic'
export const metadata = siteMetadata('education')

export default function Page() {
  return <SitePage page="education" />
}
