/** x01 website page: achievements (preview-locked until the switch; see components/site/SitePage.tsx). */

import { SitePage, siteGenerateMetadata } from '@/components/site/SitePage'

export const dynamic = 'force-dynamic'
export const generateMetadata = () => siteGenerateMetadata('achievements')

export default function Page() {
  return <SitePage page="achievements" />
}
