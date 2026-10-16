/** Rules & policies — request shapes. */

import { z } from 'zod'

export const writtenRuleSchema = z.object({
  scope: z.enum(['GLOBAL', 'CAMPUS', 'LEVEL', 'GROUP']),
  scopeId: z.string().max(40).optional().nullable(),
  textEn: z.string().trim().min(2, 'Write the rule').max(1000),
  textAr: z.string().trim().min(2, 'اكتب القاعدة').max(1000),
  sortOrder: z.coerce.number().int().min(0).max(999).optional(),
  isActive: z.boolean().optional(),
})

export const acceptRulesSchema = z.object({
  groupId: z.string().min(1).max(40),
  studentId: z.string().min(1).max(40),
  hash: z.string().length(64),
})
