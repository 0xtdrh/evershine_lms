/** x01: the website forms — what a visitor may send (pure, shared by the form and the API). */

import { z } from 'zod'

export const REQUEST_KINDS = ['CONTACT', 'SOLUTION', 'SCHOOL', 'PARTNER', 'PRODUCT'] as const
export type RequestKind = (typeof REQUEST_KINDS)[number]

export const KIND_LABEL: Record<RequestKind, { en: string; ar: string }> = {
  CONTACT: { en: 'Contact', ar: 'تواصل' },
  SOLUTION: { en: 'Solution request', ar: 'طلب حل' },
  SCHOOL: { en: 'School offer', ar: 'عرض لمدرسة' },
  PARTNER: { en: 'Partnership', ar: 'طلب شراكة' },
  PRODUCT: { en: 'Product order', ar: 'طلب منتج' },
}

/** Kinds that need the organisation's name. */
export const NEEDS_ORG: RequestKind[] = ['SOLUTION', 'SCHOOL', 'PARTNER']

/** Egyptian mobile (01xxxxxxxxx) or an international number (+ and 8–15 digits). Arabic digits are accepted. */
export function normalizePhone(raw: string): string | null {
  const s = raw.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[\s\-()]/g, '')
  if (/^01[0125]\d{8}$/.test(s)) return s
  if (/^\+\d{8,15}$/.test(s)) return s
  if (/^00\d{8,15}$/.test(s)) return `+${s.slice(2)}`
  return null
}

export const websiteRequestSchema = z
  .object({
    kind: z.enum(REQUEST_KINDS),
    name: z.string().trim().min(2).max(120),
    phone: z.string().trim().min(6).max(30),
    email: z.string().trim().email().max(160).optional().or(z.literal('')),
    organisation: z.string().trim().max(160).optional().or(z.literal('')),
    topic: z.string().trim().max(80).optional().or(z.literal('')),
    message: z.string().trim().max(2000).optional().or(z.literal('')),
    page: z.string().trim().max(80).optional().or(z.literal('')),
    /** honeypot: people never fill it */
    website: z.string().max(0).optional().or(z.literal('')),
  })
  .superRefine((v, ctx) => {
    if (!normalizePhone(v.phone)) ctx.addIssue({ code: 'custom', path: ['phone'], message: 'Enter a valid phone number · اكتب رقم موبايل صحيح' })
    if (NEEDS_ORG.includes(v.kind) && !(v.organisation ?? '').trim()) ctx.addIssue({ code: 'custom', path: ['organisation'], message: 'Write the name of the school / company · اكتب اسم المدرسة أو الشركة' })
    if (((v.message ?? '').match(/https?:\/\//g)?.length ?? 0) > 3) ctx.addIssue({ code: 'custom', path: ['message'], message: 'Too many links · لينكات كتير' })
  })

export type WebsiteRequestInput = z.infer<typeof websiteRequestSchema>
