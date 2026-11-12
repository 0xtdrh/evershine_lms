/**
 * /verify/<certificate number> — anyone can check a certificate (QR on the certificate). x01: in the new website's look
 * wherever the new website is open (this computer now, everyone after the switch); the old page meanwhile elsewhere.
 */

import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { canOpenSitePreview } from '@/lib/site/preview-access'
import { SITE_LIVE } from '@/lib/site/pages'
import { checkCertificate } from '@/lib/site/verify'
import { MINUTE, rateLimit } from '@/lib/rate-limit-db'
import { SitePage } from '@/components/site/SitePage'
import LegacyVerifyPage from '@/components/verify/LegacyVerifyPage'

export const dynamic = 'force-dynamic'
export const metadata = { title: { absolute: 'Certificate check — TechNova' }, robots: { index: false, follow: false } }

export default async function VerifyCertificatePage({ params }: { params: Promise<{ certificateNumber: string }> }) {
  const { certificateNumber } = await params
  const number = decodeURIComponent(certificateNumber)
  const session = await auth()
  if (!SITE_LIVE && !canOpenSitePreview((await headers()).get('host'), session?.user?.role)) return <LegacyVerifyPage certificateNumber={number} />
  // same limit as the check API: certificate numbers run in order, so nobody may walk through them
  const h = await headers()
  const ip = (h.get('x-forwarded-for')?.split(',')[0] || h.get('x-real-ip') || 'unknown').trim().slice(0, 64)
  const limited = await rateLimit(`verify:ip:${ip}`, 60, 10 * MINUTE)
  const cert = limited.ok ? await checkCertificate(number).catch(() => null) : null
  return <SitePage page="verify" open certificate={{ number, result: cert }} />
}
