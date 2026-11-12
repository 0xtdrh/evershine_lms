/**
 * x01 — the new TechNova home page, until the owner approves it. On the owner's own computer (localhost) anyone can
 * open it; on a real domain only a signed-in Super Admin / Admin (everyone else gets 404). Search engines are told not
 * to index it. The current home page (app/page.tsx) is not touched. All website pages render through SitePage.
 */

import { SitePage, siteMetadata } from '@/components/site/SitePage'

export const dynamic = 'force-dynamic'
export const metadata = siteMetadata('home')

export default function NewHomePreview() {
  return <SitePage page="home" />
}
