/**
 * Batch & Campus Zod Schemas
 */

import { z } from 'zod'
import { sessionShiftSchema } from './shift'

export const createCampusSchema = z.object({
  name: z.string().min(3).trim(),
  code: z.string().min(2).max(5).toUpperCase().trim(),
  address: z.string().min(5).trim(),
  phone: z.string().regex(/^\+?[\d\s\-]{10,15}$/),
  email: z.string().email().toLowerCase(),
  principalName: z.string().min(3).trim(),
})

export const updateCampusSchema = createCampusSchema.partial().extend({
  // Branch profile (phase A) — optional, empty = cleared
  mapUrl: z.preprocess((v) => (v === '' ? null : v), z.string().url().max(500).nullable().optional()),
  whatsapp: z.preprocess((v) => (v === '' ? null : v), z.string().regex(/^\+?[\d\s\-]{8,20}$/, 'Invalid WhatsApp number').nullable().optional()),
  workingHours: z.preprocess((v) => (v === '' ? null : v), z.string().max(1000).nullable().optional()),
  roomsCount: z.number().int().min(0).max(500).nullable().optional(),
  maxStudents: z.number().int().min(0).max(100000).nullable().optional(),
  managerUserId: z.preprocess((v) => (v === '' ? null : v), z.string().min(1).nullable().optional()),
  profileNotes: z.preprocess((v) => (v === '' ? null : v), z.string().max(5000).nullable().optional()),
})

export const createBatchSchema = z.object({
  name: z.string().min(2).trim(),
  code: z.string().min(2).max(5).toUpperCase().trim(),
  campusId: z.string().cuid(),
  academicLevel: z.enum(['PreSchool', 'Elementary', 'Secondary', 'HigherSecondary']),
  forceGenderSeparation: z.boolean().default(false),
  description: z.string().optional(),
})

export const updateBatchSchema = createBatchSchema.partial()

export const createClassSchema = z.object({
  name: z.string().min(2).trim(),
  grade: z.number().int().min(1).max(14),
  section: z.string().max(3).optional(),
  // WHY: Morning and Evening classes for the same grade/section are distinct entities
  shift: sessionShiftSchema.default('MORNING'),
  campusId: z.string().cuid(),
  batchId: z.preprocess((v) => (v === '' ? undefined : v), z.string().cuid().optional()), // batches are off
  academicYear: z.string().regex(/^\d{4}-\d{4}$/),
  capacity: z.number().int().min(1).max(100).default(40),
  roomNumber: z.string().optional(),
})

export const updateClassSchema = createClassSchema.partial()

export const createHouseSchema = z.object({
  name: z.string().min(2).trim(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Must be a valid hex color'),
  batchId: z.string().cuid(),
  motto: z.string().optional(),
  captainId: z.string().cuid().optional(),
  viceCaptainId: z.string().cuid().optional(),
})

export const updateHouseSchema = createHouseSchema.partial()

export type CreateCampusInput = z.infer<typeof createCampusSchema>
export type CreateBatchInput = z.infer<typeof createBatchSchema>
export type CreateClassInput = z.infer<typeof createClassSchema>
export type CreateHouseInput = z.infer<typeof createHouseSchema>
