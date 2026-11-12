/** Six phases 1-a: the website sign-up — what may be sent (pure, shared by the steps and the API, tested). */

import { z } from 'zod'
import { normalizePhone } from './request-rules'

export const MIN_SELF_AGE = 18

const name = z.string().trim().min(2).max(60)
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

export const signupSchema = z
  .object({
    listing: z.string().trim().min(1).max(60),
    mode: z.enum(['ONLINE', 'RECORDED']),
    groupId: z.string().max(40).optional().nullable(),
    who: z.enum(['PARENT', 'SELF']),
    parent: z.object({ firstName: name, lastName: name, phone: z.string().trim().max(30), email: z.string().trim().email().max(160).optional().or(z.literal('')), relation: z.string().max(20).optional() }).optional().nullable(),
    selfPhone: z.string().trim().max(30).optional().nullable(),
    selfEmail: z.string().trim().email().max(160).optional().or(z.literal('')).nullable(),
    country: z.string().trim().min(2).max(60).default('Egypt'),
    city: z.string().trim().min(2).max(60),
    students: z.array(z.object({ firstName: name, lastName: name, dob: day, gender: z.enum(['MALE', 'FEMALE']), school: z.string().trim().max(120).optional(), experience: z.string().trim().max(300).optional() })).min(1).max(5),
    code: z.string().trim().max(40).optional().nullable(),
    paymentRef: z.string().trim().max(80).optional().nullable(),
    referral: z.string().trim().max(40).optional().nullable(),
    agree: z.literal(true),
    website: z.string().max(0).optional().or(z.literal('')),
    sid: z.string().regex(/^[A-Za-z0-9_-]{8,40}$/).optional().or(z.literal('')),
  })
  .superRefine((v, ctx) => {
    if (v.who === 'PARENT') {
      if (!v.parent) ctx.addIssue({ code: 'custom', path: ['parent'], message: 'Parent details are needed · بيانات ولي الأمر مطلوبة' })
      else if (!normalizePhone(v.parent.phone)) ctx.addIssue({ code: 'custom', path: ['parent', 'phone'], message: 'Enter a valid phone number · اكتب رقم موبايل صحيح' })
    } else {
      if (v.students.length !== 1) ctx.addIssue({ code: 'custom', path: ['students'], message: 'Signing up alone is for one student · التسجيل لوحدك لطالب واحد' })
      if (!v.selfPhone || !normalizePhone(v.selfPhone)) ctx.addIssue({ code: 'custom', path: ['selfPhone'], message: 'Enter a valid phone number · اكتب رقم موبايل صحيح' })
    }
  })
export type SignupInput = z.infer<typeof signupSchema>

/** Age in whole years on a Cairo day 'YYYY-MM-DD'. */
export function ageOnDay(dob: string, today: string): number {
  const [y, m, d] = dob.split('-').map(Number)
  const [ty, tm, td] = today.split('-').map(Number)
  return ty - y - (tm < m || (tm === m && td < d) ? 1 : 0)
}

/** The phone the family is reached on (parent, or the student signing up alone). */
export const contactPhone = (v: Pick<SignupInput, 'who' | 'parent' | 'selfPhone'>) => normalizePhone(v.who === 'PARENT' ? v.parent?.phone ?? '' : v.selfPhone ?? '')

/** The steps of the sign-up, in order (a step that does not apply is skipped). */
export const SIGNUP_STEPS = ['course', 'time', 'who', 'family', 'students', 'review', 'pay', 'done'] as const
export type SignupStep = (typeof SIGNUP_STEPS)[number]
export function stepsFor(mode: 'ONLINE' | 'RECORDED' | null, who: 'PARENT' | 'SELF' | null): SignupStep[] {
  return SIGNUP_STEPS.filter((s) => !(s === 'time' && mode !== 'ONLINE') && !(s === 'family' && who === 'SELF'))
}
