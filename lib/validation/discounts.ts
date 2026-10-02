import { z } from 'zod'

const optionalDate = z
  .string()
  .optional()
  .nullable()
  .transform((v) => (v ? new Date(v) : null))
  .refine((d) => d === null || !Number.isNaN(d.getTime()), 'Invalid date')

export const discountTypeSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    kind: z.enum(['MANUAL', 'SIBLING', 'PROMO', 'OTHER']),
    valueType: z.enum(['PERCENT', 'FIXED']),
    value: z.number().min(0).max(100000),
    editableValue: z.boolean().default(false),
    maxValue: z.number().min(0).max(100000).optional().nullable(),
    duration: z.enum(['EVERY_CYCLE', 'FIRST_CYCLE', 'ONE_TIME']),
    autoApply: z.boolean().default(false),
    approvalMode: z.enum(['STAFF', 'MANAGER', 'STAFF_WITH_APPROVAL']),
    scopeType: z.enum(['ALL', 'TRACK', 'COURSE', 'LEVEL', 'GROUP']).default('ALL'),
    scopeId: z.string().optional().nullable(),
    validFrom: optionalDate,
    validTo: optionalDate,
    stackable: z.boolean().default(true),
    isActive: z.boolean().default(true),
  })
  .superRefine((v, ctx) => {
    if (v.valueType === 'PERCENT' && v.value > 100) ctx.addIssue({ code: 'custom', path: ['value'], message: 'A percentage cannot be more than 100' })
    if (v.valueType === 'PERCENT' && v.maxValue != null && v.maxValue > 100) ctx.addIssue({ code: 'custom', path: ['maxValue'], message: 'A percentage cannot be more than 100' })
    if (v.scopeType !== 'ALL' && !v.scopeId) ctx.addIssue({ code: 'custom', path: ['scopeId'], message: 'Choose where this discount applies' })
    if (v.validFrom && v.validTo && v.validTo < v.validFrom) ctx.addIssue({ code: 'custom', path: ['validTo'], message: 'End date is before start date' })
    if (v.editableValue && v.maxValue != null && v.value > v.maxValue) ctx.addIssue({ code: 'custom', path: ['value'], message: 'Default value is above the maximum' })
  })

export const discountAssignmentSchema = z
  .object({
    discountTypeId: z.string().min(1),
    /** A student, or null for a whole-group discount (then classSectionId is required). */
    studentId: z.string().optional().nullable(),
    classSectionId: z.string().optional().nullable(),
    trackId: z.string().optional().nullable(),
    /** Only for types with editableValue. */
    value: z.number().min(0).max(100000).optional().nullable(),
    reason: z.string().trim().max(500).optional().nullable(),
  })
  .superRefine((v, ctx) => {
    if (!v.studentId && !v.classSectionId) ctx.addIssue({ code: 'custom', path: ['studentId'], message: 'Choose a student or a group' })
    if (v.classSectionId && v.trackId) ctx.addIssue({ code: 'custom', path: ['trackId'], message: 'Choose a group OR a track, not both' })
  })

export const discountActionSchema = z.object({
  action: z.enum(['approve', 'reject', 'end']),
  reason: z.string().trim().max(500).optional().nullable(),
})

export const discountRulesSchema = z.object({
  allowStacking: z.boolean(),
  maxTotalPercent: z.number().min(0).max(100).nullable(),
  siblingAppliesTo: z.enum(['SECOND_AND_LATER', 'ALL']),
})
