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
