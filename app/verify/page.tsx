/** x01 website page: verify (preview-locked until the switch; see components/site/SitePage.tsx). */

import { SitePage, siteGenerateMetadata } from '@/components/site/SitePage'

export const dynamic = 'force-dynamic'
export const generateMetadata = () => siteGenerateMetadata('verify')

export default function Page() {
  return <SitePage page="verify" />
}
