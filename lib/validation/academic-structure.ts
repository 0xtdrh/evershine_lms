import { z } from 'zod'

export const createTrackSchema = z.object({
  name: z.string().min(1, 'Track name is required').max(100),
  minAge: z.number().int().min(0).max(100).optional().nullable(),
  maxAge: z.number().int().min(0).max(100).optional().nullable(),
  description: z.string().max(500).optional().nullable(),
}).refine(
  (data) => data.minAge == null || data.maxAge == null || data.minAge <= data.maxAge,
  { message: 'Minimum age must be less than or equal to maximum age', path: ['maxAge'] }
)

export const updateTrackSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  minAge: z.number().int().min(0).max(100).optional().nullable(),
  maxAge: z.number().int().min(0).max(100).optional().nullable(),
  description: z.string().max(500).optional().nullable(),
  isActive: z.boolean().optional(),
})

const levelPricingTypeEnum = z.enum(['MONTHLY', 'FULL_LEVEL'])

export const createLevelSchema = z.object({
  subjectId: z.string().min(1, 'Course is required'),
  name: z.string().min(1, 'Level name is required').max(100),
  order: z.number().int().min(1, 'Order must be at least 1'),
  numberOfMonths: z.number().int().min(1, 'Must be at least 1 month'),
  numberOfSessions: z.number().int().min(1, 'Must be at least 1 session'),
  pricingType: levelPricingTypeEnum,
  monthlyPrice: z.number().min(0).optional().nullable(),
  fullLevelPrice: z.number().min(0).optional().nullable(),
}).refine(
  (data) => data.pricingType !== 'MONTHLY' || (data.monthlyPrice != null && data.monthlyPrice > 0),
  { message: 'A monthly price is required for monthly pricing', path: ['monthlyPrice'] }
).refine(
  (data) => data.pricingType !== 'FULL_LEVEL' || (data.fullLevelPrice != null && data.fullLevelPrice > 0),
  { message: 'A full-level price is required for full-level pricing', path: ['fullLevelPrice'] }
)

export const updateLevelSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  order: z.number().int().min(1).optional(),
  numberOfMonths: z.number().int().min(1).optional(),
  numberOfSessions: z.number().int().min(1).optional(),
  pricingType: levelPricingTypeEnum.optional(),
  monthlyPrice: z.number().min(0).optional().nullable(),
  fullLevelPrice: z.number().min(0).optional().nullable(),
  isActive: z.boolean().optional(),
})
