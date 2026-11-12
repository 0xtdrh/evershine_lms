/** Six phases 1-a: enrolment codes — making and checking them (pure, tested). */

import { z } from 'zod'

export const CODE_KINDS = ['FREE', 'PERCENT', 'AMOUNT'] as const
export type CodeKind = (typeof CODE_KINDS)[number]
export const CODE_KIND_LABEL: Record<CodeKind, { en: string; ar: string }> = {
  FREE: { en: 'Free (100%)', ar: 'مجاني (100%)' }, PERCENT: { en: 'Percent off', ar: 'خصم بنسبة' }, AMOUNT: { en: 'Amount off', ar: 'خصم بمبلغ' },
}

/** No 0/O, 1/I/L: easy to read on a printed card. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export function makeCode(prefix: string, random: (max: number) => number, length = 6): string {
  let tail = ''
  for (let i = 0; i < length; i++) tail += ALPHABET[random(ALPHABET.length)]
  const p = prefix.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20)
  return p ? `${p}-${tail}` : tail
}
export const normalizeCode = (raw: string) => raw.trim().toUpperCase().replace(/\s+/g, '').slice(0, 40)

export const batchSchema = z
  .object({
    batch: z.string().trim().min(2).max(30).regex(/^[A-Za-z0-9-]+$/, 'English letters, numbers and - only · حروف إنجليزي وأرقام و - بس'),
    count: z.number().int().min(1).max(500),
    kind: z.enum(CODE_KINDS),
    value: z.number().min(0).max(1_000_000).default(0),
    duration: z.enum(['FIRST_CYCLE', 'EVERY_CYCLE', 'ONE_TIME']).default('FIRST_CYCLE'),
    scope: z.enum(['ANY', 'LISTING']).default('ANY'),
    scopeIds: z.array(z.string().max(60)).max(50).default([]),
    maxUses: z.number().int().min(1).max(100_000).nullable().default(1),
    expiresAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    partnerId: z.string().max(40).nullable().optional(),
    note: z.string().trim().max(200).nullable().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.kind === 'PERCENT' && (v.value <= 0 || v.value > 100)) ctx.addIssue({ code: 'custom', path: ['value'], message: 'A percent from 1 to 100 · نسبة من 1 لـ 100' })
    if (v.kind === 'AMOUNT' && v.value <= 0) ctx.addIssue({ code: 'custom', path: ['value'], message: 'Write the amount · اكتب المبلغ' })
    if (v.scope === 'LISTING' && !v.scopeIds.length) ctx.addIssue({ code: 'custom', path: ['scopeIds'], message: 'Choose the courses · اختار الكورسات' })
  })
export type BatchInput = z.infer<typeof batchSchema>

export type CodeProblem = 'NOT_FOUND' | 'OFF' | 'EXPIRED' | 'USED_UP' | 'NOT_THIS_COURSE' | 'ALREADY_USED'
export const PROBLEM_TEXT: Record<CodeProblem, { en: string; ar: string }> = {
  NOT_FOUND: { en: 'This code does not exist', ar: 'الكود ده مش موجود' },
  OFF: { en: 'This code is stopped', ar: 'الكود ده متوقف' },
  EXPIRED: { en: 'This code has expired', ar: 'الكود ده انتهى' },
  USED_UP: { en: 'This code was used the maximum number of times', ar: 'الكود ده خلص عدد مرات استخدامه' },
  NOT_THIS_COURSE: { en: 'This code is not for this course', ar: 'الكود ده مش للكورس ده' },
  ALREADY_USED: { en: 'You already used this code', ar: 'انت استخدمت الكود ده قبل كده' },
}

/** Can this code be used now, for this course page, by this phone? `today` is a Cairo day 'YYYY-MM-DD'. */
export function checkCode(
  c: { isActive: boolean; expiresAt: Date | string | null; maxUses: number | null; uses: number; scope: string; scopeIds: unknown } | null,
  ctx: { listing: string | null; today: string; usedByPhone: boolean },
): { ok: boolean; problem?: CodeProblem } {
  if (!c) return { ok: false, problem: 'NOT_FOUND' }
  if (!c.isActive) return { ok: false, problem: 'OFF' }
  if (c.expiresAt && new Date(c.expiresAt).toISOString().slice(0, 10) < ctx.today) return { ok: false, problem: 'EXPIRED' }
  if (c.maxUses != null && c.uses >= c.maxUses) return { ok: false, problem: 'USED_UP' }
  if (c.scope === 'LISTING') {
    const ids = Array.isArray(c.scopeIds) ? (c.scopeIds as unknown[]).map(String) : []
    if (!ctx.listing || !ids.includes(ctx.listing)) return { ok: false, problem: 'NOT_THIS_COURSE' }
  }
  if (ctx.usedByPhone) return { ok: false, problem: 'ALREADY_USED' }
  return { ok: true }
}

/** What the visitor reads after a good code: «خصم 20%» / «مجاني». */
export function codeBenefit(kind: string, value: number, ar: boolean): string {
  if (kind === 'FREE') return ar ? 'مجاني بالكامل' : 'Completely free'
  if (kind === 'PERCENT') return ar ? `خصم ${value}%` : `${value}% off`
  return ar ? `خصم ${value.toLocaleString('en-US')} جنيه` : `${value.toLocaleString('en-US')} EGP off`
}
