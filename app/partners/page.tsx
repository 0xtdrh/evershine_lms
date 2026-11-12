/** x01 website page: partners (preview-locked until the switch; see components/site/SitePage.tsx). */

import { SitePage, siteGenerateMetadata } from '@/components/site/SitePage'

export const dynamic = 'force-dynamic'
export const generateMetadata = () => siteGenerateMetadata('partners')

export default function Page() {
  return <SitePage page="partners" />
}
