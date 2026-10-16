/** M1 partners — request shapes (shared by the API routes). */

import { z } from 'zod'
import { PARTNER_KINDS } from './rules'

const opt = (max: number) => z.string().trim().max(max).optional().nullable()

export const partnerSchema = z.object({
  name: z.string().trim().min(2, 'Write the partner name').max(150),
  kind: z.enum(PARTNER_KINDS),
  contactName: opt(120),
  contactPhone: opt(40),
  contactEmail: z.union([z.string().trim().email('The email is not valid').max(150), z.literal('')]).optional().nullable(),
  address: opt(500),
  notes: opt(3000),
  isActive: z.boolean().optional(),
})

export const placeSchema = z.object({
  name: z.string().trim().min(2, 'Write the place name').max(120),
  address: opt(500),
  phone: opt(40),
  email: z.union([z.string().trim().email('The email is not valid').max(150), z.literal('')]).optional().nullable(),
  principalName: opt(120),
  isActive: z.boolean().optional(),
})

const DATE = /^\d{4}-\d{2}-\d{2}$/
export const contractSchema = z.object({
  title: z.string().trim().min(2, 'Write a title for the contract').max(200),
  startDate: z.string().regex(DATE, 'Choose the start date'),
  endDate: z.union([z.string().regex(DATE), z.literal('')]).optional().nullable(),
  alertDaysBefore: z.coerce.number().int().min(0).max(365).optional(),
  notes: opt(3000),
})

export const fileSchema = z.object({
  publicId: z.string().min(3).max(400),
  resourceType: z.enum(['image', 'raw']),
  format: z.string().max(20).optional().nullable(),
  bytes: z.number().int().nonnegative().optional().nullable(),
  originalName: z.string().max(180).optional().nullable(),
})

export const overrideItemsSchema = z.object({
  role: z.string().max(20).optional(),
  items: z.array(z.object({
    resource: z.string().min(1).max(60),
    action: z.enum(['create', 'read', 'update', 'delete', 'export', 'approve']),
    allowed: z.boolean(),
  })).max(400),
})

// ── Partners part 1: deals, place prices, session logs ──
export const dealSchema = z.object({
  title: z.string().trim().min(2, 'Write a name for the deal').max(150),
  campusId: z.string().max(40).optional().nullable(),
  contractId: z.string().max(40).optional().nullable(),
  collector: z.enum(['TECHNOVA', 'PARTNER', 'INSTITUTION']),
  components: z.array(z.object({
    kind: z.enum(['PERCENT', 'FIXED_MONTHLY', 'PER_SESSION', 'PER_HOUR', 'PER_STUDENT_MONTH', 'PER_GROUP_MONTH', 'PER_TERM', 'MINIMUM']),
    value: z.coerce.number().min(0).max(10_000_000),
    base: z.enum(['NET', 'GROSS']).optional(),
    hoursPerSession: z.coerce.number().min(0.25).max(12).optional(),
  })).min(1, 'Add at least one piece to the deal').max(10),
  extras: z.array(z.object({
    label: z.string().trim().min(1).max(80),
    amount: z.coerce.number().min(0).max(10_000_000),
    per: z.enum(['ONCE', 'MONTH', 'SESSION']),
    payer: z.enum(['TECHNOVA', 'PARTNER']),
  })).max(10).optional().nullable(),
  countPartnerCancelled: z.boolean().optional(),
  period: z.enum(['MONTH', 'TERM']).optional(),
  validFrom: z.string().regex(DATE, 'Choose the start date'),
  validTo: z.union([z.string().regex(DATE), z.literal('')]).optional().nullable(),
  notes: opt(2000),
  isActive: z.boolean().optional(),
})

export const placePricesSchema = z.object({
  items: z.array(z.object({
    levelId: z.string().min(1).max(40),
    monthlyPrice: z.number().min(0).max(1_000_000).nullable().optional(),
    fullLevelPrice: z.number().min(0).max(1_000_000).nullable().optional(),
  })).max(500),
})

export const sessionLogSchema = z.object({
  date: z.string().regex(DATE, 'Choose the date'),
  status: z.enum(['HELD', 'CANCELLED_PARTNER', 'CANCELLED_TECHNOVA']),
  headcount: z.number().int().min(0).max(500).nullable().optional(),
  note: opt(500),
})

// ── Partners part 1-B: statements ──
export const makeStatementSchema = z.object({
  campusId: z.string().max(40).optional().nullable(),
  from: z.string().regex(DATE, 'Choose the start of the period'),
  to: z.string().regex(DATE, 'Choose the end of the period'),
})

export const statementEditSchema = z.object({
  manualLines: z.array(z.object({
    label: z.string().trim().min(1).max(120),
    amount: z.coerce.number().min(0).max(10_000_000),
    payer: z.enum(['TECHNOVA', 'PARTNER']),
    reason: z.string().trim().max(300).optional().nullable(),
  })).max(20).optional(),
  notes: opt(2000),
})

export const statementPaymentSchema = z.object({
  direction: z.enum(['PARTNER_TO_TECHNOVA', 'TECHNOVA_TO_PARTNER']),
  amount: z.coerce.number().positive().max(10_000_000),
  method: z.string().trim().min(1).max(50),
  paidAt: z.string().regex(DATE, 'Choose the payment date'),
  reference: z.string().trim().max(120).optional().nullable(),
  note: opt(500),
})

// ── Partners part 1-B2: contacts, activities ──
export const contactSchema = z.object({
  name: z.string().trim().min(2, 'Write the name').max(120),
  role: z.enum(['DECISION_MAKER', 'FINANCE', 'ACADEMIC', 'PLACE_MANAGER', 'OTHER']),
  jobTitle: opt(120),
  phone: opt(40),
  email: z.union([z.string().trim().email('The email is not valid').max(150), z.literal('')]).optional().nullable(),
  isPrimary: z.boolean().optional(),
  notes: opt(1000),
})

export const activitySchema = z.object({
  kind: z.enum(['CALL', 'MEETING', 'VISIT', 'MESSAGE', 'OTHER']),
  happenedAt: z.string().regex(DATE, 'Choose the date'),
  summary: z.string().trim().min(2, 'Write what was said').max(3000),
  followUpAt: z.union([z.string().regex(DATE), z.literal('')]).optional().nullable(),
  followUpDone: z.boolean().optional(),
})
