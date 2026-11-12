/** x01: campaign pages — read / write and their numbers (server only). */

import { prisma } from '@/lib/prisma'
import { cairoToday } from '@/lib/dates/cairo'
import { bothSides } from './items'
import { campaignState, type CampaignInput } from './campaigns'

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null)
const data = (v: CampaignInput) => {
  const title = bothSides(v.titleEn, v.titleAr)
  return {
    slug: v.slug, titleEn: title.en, titleAr: title.ar, textEn: v.textEn || null, textAr: v.textAr || null,
    offerEn: v.offerEn || null, offerAr: v.offerAr || null, imageUrl: v.imageUrl || null, videoUrl: v.videoUrl || null,
    formKind: v.formKind ?? 'CONTACT', startsAt: v.startsAt ? new Date(`${v.startsAt}T00:00:00Z`) : null, endsAt: v.endsAt ? new Date(`${v.endsAt}T00:00:00Z`) : null,
    banner: v.banner ?? false, bannerEn: v.bannerEn || null, bannerAr: v.bannerAr || null, show: v.show ?? true,
  }
}

export async function listCampaigns() {
  const rows = await prisma.siteCampaign.findMany({ orderBy: { createdAt: 'desc' } })
  const today = cairoToday()
  return Promise.all(rows.map(async (c) => {
    const [visits, requests] = await Promise.all([
      prisma.siteVisit.count({ where: { landing: { startsWith: `/c/${c.slug}` } } }),
      prisma.landingInquiry.count({ where: { page: `campaign:${c.slug}` } }),
    ])
    return { ...c, startsAt: day(c.startsAt), endsAt: day(c.endsAt), state: campaignState({ show: c.show, startsAt: day(c.startsAt), endsAt: day(c.endsAt) }, today), visits, requests }
  }))
}

export const slugTaken = async (slug: string, notId?: string) => !!(await prisma.siteCampaign.findFirst({ where: { slug, ...(notId ? { id: { not: notId } } : {}) }, select: { id: true } }))
export const createCampaign = (userId: string, v: CampaignInput) => prisma.siteCampaign.create({ data: { ...data(v), createdById: userId } })
export const updateCampaign = (id: string, v: CampaignInput) => prisma.siteCampaign.update({ where: { id }, data: data(v) })
export const deleteCampaign = (id: string) => prisma.siteCampaign.delete({ where: { id } })

export interface PublicCampaign {
  slug: string; title: { en: string; ar: string }; text: { en: string; ar: string }; offer: { en: string; ar: string }
  imageUrl: string | null; videoUrl: string | null; formKind: string; startsAt: string | null; endsAt: string | null
  state: ReturnType<typeof campaignState>; banner: { en: string; ar: string } | null
}
const toPublic = (c: Awaited<ReturnType<typeof prisma.siteCampaign.findMany>>[number], today: string): PublicCampaign => ({
  slug: c.slug, title: { en: c.titleEn, ar: c.titleAr }, text: bothSides(c.textEn, c.textAr), offer: bothSides(c.offerEn, c.offerAr),
  imageUrl: c.imageUrl, videoUrl: c.videoUrl, formKind: c.formKind, startsAt: day(c.startsAt), endsAt: day(c.endsAt),
  state: campaignState({ show: c.show, startsAt: day(c.startsAt), endsAt: day(c.endsAt) }, today),
  banner: c.banner ? bothSides(c.bannerEn || c.titleEn, c.bannerAr || c.titleAr) : null,
})

export async function campaignBySlug(slug: string) {
  const c = await prisma.siteCampaign.findUnique({ where: { slug } }).catch(() => null)
  return c ? toPublic(c, cairoToday()) : null
}

/** The banner on top of the website: the newest live campaign that asks for one. */
export async function activeBanner(): Promise<PublicCampaign | null> {
  try {
    const today = cairoToday()
    const rows = await prisma.siteCampaign.findMany({ where: { show: true, banner: true }, orderBy: { createdAt: 'desc' }, take: 10 })
    return rows.map((r) => toPublic(r, today)).find((c) => c.state === 'LIVE') ?? null
  } catch {
    return null
  }
}
