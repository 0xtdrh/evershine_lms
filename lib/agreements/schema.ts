/** Validation for agreement create / edit (shared by the API routes). */

import { z } from 'zod'

export const agreementSchema = z.object({
  key: z.string().trim().regex(/^[a-z0-9-]{2,40}$/, 'Use small letters, numbers and dashes'),
  audience: z.enum(['PARENT', 'STUDENT', 'STAFF']),
  titleEn: z.string().trim().min(2).max(160),
  titleAr: z.string().trim().min(2).max(160),
  bodyEn: z.string().trim().min(5).max(50000),
  bodyAr: z.string().trim().min(5).max(50000),
  mandatory: z.boolean().optional(),
  isActive: z.boolean().optional(),
  graceDays: z.number().int().min(0).max(60).optional(),
  sortOrder: z.number().int().min(0).max(100).optional(),
})
