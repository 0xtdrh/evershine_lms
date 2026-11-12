/** x01: campaign pages — validation and state (pure, tested). */

import { z } from 'zod'
import { REQUEST_KINDS } from './request-rules'

export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,58}[a-z0-9])$/

const url = z.string().trim().max(500).refine((v) => v === '' || /^https?:\/\//i.test(v), 'Links start with https:// · اللينك لازم يبدأ بـ https://')
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable().or(z.literal(''))
const opt = (n: number) => z.string().trim().max(n).optional().nullable()

export const campaignSchema = z
  .object({
    slug: z.string().trim().toLowerCase().regex(SLUG_RE, 'The link name: small English letters, numbers and - only · اسم اللينك: حروف إنجليزي صغيرة وأرقام و - بس'),
    titleEn: z.string().trim().max(160), titleAr: z.string().trim().max(160),
    textEn: opt(6000), textAr: opt(6000), offerEn: opt(200), offerAr: opt(200),
    imageUrl: url.optional().nullable(), videoUrl: url.optional().nullable(),
    formKind: z.enum(REQUEST_KINDS).optional(),
    startsAt: day, endsAt: day,
    banner: z.boolean().optional(), bannerEn: opt(160), bannerAr: opt(160), show: z.boolean().optional(),
  })
  .superRefine((v, ctx) => {
    if (!v.titleAr && !v.titleEn) ctx.addIssue({ code: 'custom', path: ['titleAr'], message: 'Write a title · اكتب العنوان' })
    if (v.startsAt && v.endsAt && v.endsAt < v.startsAt) ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'The end is before the start · النهاية قبل البداية' })
  })
export type CampaignInput = z.infer<typeof campaignSchema>

export type CampaignState = 'HIDDEN' | 'UPCOMING' | 'LIVE' | 'ENDED'
export const STATE_LABEL: Record<CampaignState, { en: string; ar: string }> = {
  HIDDEN: { en: 'Hidden', ar: 'مخفية' }, UPCOMING: { en: 'Not started', ar: 'لسه مابدأتش' }, LIVE: { en: 'Live', ar: 'شغالة' }, ENDED: { en: 'Ended', ar: 'خلصت' },
}

/** Days are Cairo days as 'YYYY-MM-DD'; a campaign is live from its start day to its end day, both included. */
export function campaignState(c: { show: boolean; startsAt?: string | null; endsAt?: string | null }, today: string): CampaignState {
  if (!c.show) return 'HIDDEN'
  if (c.startsAt && today < c.startsAt) return 'UPCOMING'
  if (c.endsAt && today > c.endsAt) return 'ENDED'
  return 'LIVE'
}
