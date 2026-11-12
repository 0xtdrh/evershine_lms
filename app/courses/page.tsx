/** Six phases 1-a: the website's courses page (preview-locked until the switch). */

import { SitePage, siteGenerateMetadata } from '@/components/site/SitePage'

export const dynamic = 'force-dynamic'
export const generateMetadata = () => siteGenerateMetadata('courses')

export default function Page() {
  return <SitePage page="courses" />
}
