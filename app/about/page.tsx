/** x01 website page: about (preview-locked until the switch; see components/site/SitePage.tsx). */

import { SitePage, siteGenerateMetadata } from '@/components/site/SitePage'

export const dynamic = 'force-dynamic'
export const generateMetadata = () => siteGenerateMetadata('about')

export default function Page() {
  return <SitePage page="about" />
}
