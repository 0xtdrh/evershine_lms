/** x01: website items — products, achievements / projects, media / news (pure: kinds, labels, validation). */

import { z } from 'zod'

export const ITEM_KINDS = ['PRODUCT', 'ACHIEVEMENT', 'MEDIA'] as const
export type ItemKind = (typeof ITEM_KINDS)[number]

export const CATEGORIES: Record<ItemKind, Record<string, { en: string; ar: string }>> = {
  PRODUCT: { EDUCATIONAL: { en: 'Educational', ar: 'تعليمي' }, DEVICE: { en: 'Smart device', ar: 'جهاز ذكي' }, OTHER: { en: 'Other', ar: 'تاني' } },
  ACHIEVEMENT: { COMPETITION: { en: 'Competition', ar: 'مسابقة' }, PROJECT: { en: 'Student project', ar: 'مشروع طالب' }, RND: { en: 'R&D', ar: 'بحث وتطوير' }, STORY: { en: 'Success story', ar: 'قصة نجاح' } },
  MEDIA: { VIDEO: { en: 'Video', ar: 'فيديو' }, PHOTO: { en: 'Photos', ar: 'صور' }, NEWS: { en: 'News', ar: 'خبر' }, ARTICLE: { en: 'Article', ar: 'مقال' } },
}

export const KIND_TITLE: Record<ItemKind, { en: string; ar: string }> = {
  PRODUCT: { en: 'Products', ar: 'المنتجات' },
  ACHIEVEMENT: { en: 'Achievements & projects', ar: 'الإنجازات والمشاريع' },
  MEDIA: { en: 'Media & news', ar: 'الميديا والأخبار' },
}

const url = z.string().trim().max(500).refine((v) => v === '' || /^https?:\/\//i.test(v), 'Links start with http:// or https:// · اللينك لازم يبدأ بـ https://')
const opt = (n: number) => z.string().trim().max(n).optional().nullable()

export const itemSchema = z
  .object({
    kind: z.enum(ITEM_KINDS),
    category: z.string().max(16),
    titleEn: z.string().trim().max(160),
    titleAr: z.string().trim().max(160),
    textEn: opt(4000), textAr: opt(4000), metaEn: opt(160), metaAr: opt(160),
    imageUrl: url.optional().nullable(), videoUrl: url.optional().nullable(), linkUrl: url.optional().nullable(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable().or(z.literal('')),
    price: z.number().min(0).max(10_000_000).optional().nullable(),
    showPrice: z.boolean().optional(), inStock: z.boolean().optional(), featured: z.boolean().optional(), show: z.boolean().optional(),
    sortOrder: z.number().int().min(-10000).max(10000).optional(),
  })
  .superRefine((v, ctx) => {
    if (!(v.category in CATEGORIES[v.kind])) ctx.addIssue({ code: 'custom', path: ['category'], message: 'Unknown category · نوع مش معروف' })
    if (!v.titleAr && !v.titleEn) ctx.addIssue({ code: 'custom', path: ['titleAr'], message: 'Write a title · اكتب العنوان' })
  })

export type ItemInput = z.infer<typeof itemSchema>

/** One title in both languages: an empty side borrows the other one, so the website never shows a blank. */
export function bothSides(en?: string | null, ar?: string | null) {
  const e = (en ?? '').trim()
  const a = (ar ?? '').trim()
  return { en: e || a, ar: a || e }
}

/** YouTube link → the embed link (or null when it is not YouTube). */
export function youtubeEmbed(link?: string | null): string | null {
  if (!link) return null
  const m = link.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{6,15})/)
  return m ? `https://www.youtube-nocookie.com/embed/${m[1]}` : null
}
