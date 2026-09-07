/**
 * Student Zod Schemas
 * Used for admission form validation (client) and POST /api/students (server).
 */

import { z } from 'zod'
import { sessionShiftSchema } from '@/lib/validation/shift'
import { deliveryModeSchema } from '@/lib/validation/academic'

const genderEnum = z.enum(['MALE', 'FEMALE'])
const enrollmentStatusEnum = z.enum(['ACTIVE', 'SUSPENDED', 'GRADUATED', 'WITHDRAWN', 'ON_LEAVE'])

const dateOrDateTimeString = z.preprocess((value) => {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return `${value}T00:00:00.000Z`
  }
  return value
}, z.string().datetime({ message: 'Invalid date of birth' }))

const optionalCuid = z.preprocess((value) => {
  if (typeof value === 'string' && value.trim() === '') return undefined
  return value
}, z.string().cuid().optional())

const blankOptionalNumber = (value: unknown) => {
  if (typeof value === 'string' && value.trim() === '') return undefined
  if (typeof value === 'number' && Number.isNaN(value)) return undefined
  return value
}

const createStudentSchemaBase = z.object({
  // ── Personal identity ──────────────────────────────────────────────────────
  firstName:    z.string().min(2, 'First name must be at least 2 characters').trim(),
  lastName:     z.string().min(2, 'Last name must be at least 2 characters').trim(),
  fullNameAr:   z.string().min(5, 'Full Arabic name is required').trim(),  // Full four-part Arabic legal name
  fullNameEn:   z.string().optional(),                              // Full four-part English legal name (for certificates)
  fatherName:   z.string().min(2, 'Father name is required').trim(),
  fatherPhoneNumber: z.string().optional(),
  fatherOccupation:  z.string().optional(),
  motherName:        z.string().optional(),
  motherPhoneNumber: z.string().optional(),
  motherOccupation:  z.string().optional(),
  parentStatus: z.enum(['BOTH_ALIVE', 'FATHER_DECEASED', 'MOTHER_DECEASED', 'BOTH_DECEASED', 'DIVORCED']).default('BOTH_ALIVE'),
  dateOfBirth:  dateOrDateTimeString,
  gender:       genderEnum,
  bloodGroup:   z.enum(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']).optional(),
  nationality:  z.string().default('Egyptian'),

  // ── Address ───────────────────────────────────────────────────────────────
  address: z.string().min(5, 'Address is required').trim(),
  city:    z.string().min(2).trim(),

  // ── Contact ───────────────────────────────────────────────────────────────
  phoneNumber:      z.string().regex(/^\+?[\d\s\-]{10,15}$/, 'Invalid phone number'),
  emergencyContact: z.string().regex(/^\+?[\d\s\-]{10,15}$/, 'Invalid emergency contact'),
  email:            z.string().email().optional().or(z.literal('')),

  // ── School & prior background ───────────────────────────────────────────────
  schoolName:                 z.string().optional(),  // Current regular school
  regularSchoolGrade:         z.string().optional(),  // Grade/year in their regular school
  priorProgrammingExperience: z.string().optional(),  // Free-text prior experience note

  // ── Optional medical note (never required) ─────────────────────────────────
  medicalNotes: z.string().optional(),

  // ── Sibling linkage at the same academy ────────────────────────────────────
  hasSiblingAtAcademy: z.boolean().default(false),
  siblingName:         z.string().optional(), // Full name of sibling here
  siblingClass:        z.string().optional(), // Class / section of sibling

  // ── Academic placement ─────────────────────────────────────────────────────
  campusId:       z.string().cuid('Invalid campus ID'),
  batchId:        z.string().cuid('Invalid batch ID'),
  classId:        optionalCuid,
  classSectionId: optionalCuid,
  section:        z.string().max(5).optional(),
  rollNumber:     z.string().min(1).max(20).optional(),
  shift:          sessionShiftSchema.optional(),
  deliveryMode:   deliveryModeSchema.optional(),
  houseId:        optionalCuid,
  nearestBranchId: optionalCuid,
  academicYear:   z.string().regex(/^\d{4}-\d{4}$/, 'Academic year must be in format YYYY-YYYY'),

  // ── Financial ──────────────────────────────────────────────────────────────
  totalFeeAmount: z.number().min(0).default(0),

  // ── Documents ──────────────────────────────────────────────────────────────
  profilePicture: z.string().optional(),  // Base64 or URL

  // ── Marketing / referral (also used standalone below) ───────────────────────
  sourceOfInfo: z.string().optional(),

  // Parent/Guardian details (for new admission; creates Guardian account)
  parentEmail: z.string().email().optional(),
})

const guardianFieldsSchema = z.object({
  guardianFirstName:    z.string().min(2).trim().optional(),
  guardianLastName:     z.string().trim().optional(),
  guardianPhone:        z.string().optional(),
  guardianEmail:        z.string().email().optional().or(z.literal('')),
  guardianRelationship: z.string().max(50).optional(),
})

// sourceOfInfo now lives directly on createStudentSchemaBase

// Validation for public form where terms MUST be checked
export const publicAdmissionSchema = createStudentSchemaBase
  .merge(guardianFieldsSchema)
  .extend({
    termsAccepted: z.literal(true, {
      errorMap: () => ({ message: 'You must agree to the Rules and Regulations to proceed' }),
    }),
  })


// Merge schemas first (without refinements yet)
const mergedStudentSchema = createStudentSchemaBase
  .merge(guardianFieldsSchema)

// Apply refinements to the merged schema
export const createStudentSchema = mergedStudentSchema
  .refine(
    (data) => !data.classSectionId || (data.rollNumber && data.rollNumber.length > 0),
    { message: 'Roll number is required when a class section is selected', path: ['rollNumber'] }
  )
  .refine(
    (d) => !d.guardianPhone || (d.guardianFirstName && d.guardianFirstName.length >= 2),
    { message: 'Guardian first name is required when guardian phone is provided', path: ['guardianFirstName'] }
  )

// Update schema: use partial on the base merged schema, then extend
export const updateStudentSchema = mergedStudentSchema.partial().extend({
  bloodGroup: z.enum(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']).optional().or(z.literal('')).transform((v) => v || undefined),
  enrollmentStatus: enrollmentStatusEnum.optional(),
  rollNumber: z.string().optional(),
  isActive: z.boolean().optional(),
})

export const studentIdParamSchema = z.object({
  id: z.string().cuid('Invalid student ID'),
})

export const studentQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  search: z.string().optional(),
  campusId: z.string().cuid().optional(),
  batchId: z.string().cuid().optional(),
  classId: z.string().cuid().optional(),
  section: z.string().optional(),
  enrollmentStatus: enrollmentStatusEnum.optional(),
  feeStatus: z.enum(['PENDING', 'PARTIALLY_PAID', 'PAID', 'OVERDUE']).optional(),
  academicYear: z.string().optional(),
  houseId: z.string().cuid().optional(),
  shift: sessionShiftSchema.optional(),
  classSectionId: z.string().cuid().optional(),
  includeEnrollments: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
})

export const addStudentEnrollmentSchema = z.object({
  academicYearId: z.string().cuid().optional(),
  classSectionId: z.string().cuid(),
  rollNumber: z.string().min(1).max(20),
  deliveryMode: deliveryModeSchema.optional(),
})

export const linkGuardianSchema = z.object({
  firstName: z.string().min(2).trim(),
  lastName: z.string().trim().optional(),
  phoneNumber: z.string().min(10),
  email: z.string().email().optional().or(z.literal('')),
  relationship: z.string().max(50).default('Guardian'),
})

export const studentImportRowSchema = z.object({
  firstName: z.string().min(2).trim(),
  lastName: z.string().min(2).trim(),
  fullNameAr: z.string().min(5).trim(),
  fatherName: z.string().min(2).trim(),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  gender: genderEnum,
  phoneNumber: z.string().min(10),
  emergencyContact: z.string().min(10),
  address: z.string().min(5),
  city: z.string().min(2),
  email: z.string().email().optional(),
  campusCode: z.string().min(1),
  batchCode: z.string().min(1),
  className: z.string().optional(),
  sectionName: z.string().optional(),
  rollNumber: z.string().min(1).max(20),
  shift: sessionShiftSchema.optional(),
  deliveryMode: deliveryModeSchema.optional(),
  academicYear: z.string().regex(/^\d{4}-\d{4}$/).optional(),
  totalFeeAmount: z.number().min(0).optional(),
  bloodGroup: z.enum(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']).optional(),
  nationality: z.string().optional(),
  guardianFirstName: z.string().optional(),
  guardianLastName: z.string().optional(),
  guardianPhone: z.string().optional(),
  guardianEmail: z.string().email().optional(),
  guardianRelationship: z.string().optional(),
})

export const studentBulkImportSchema = z.object({
  rows: z.array(studentImportRowSchema).min(1).max(500),
})

export type CreateStudentInput = z.infer<typeof createStudentSchema>
export type UpdateStudentInput = z.infer<typeof updateStudentSchema>
export type StudentQueryInput = z.infer<typeof studentQuerySchema>
export type StudentImportRow = z.infer<typeof studentImportRowSchema>
