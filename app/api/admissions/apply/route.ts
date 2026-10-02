import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { uploadProfileImageToCloudinary } from '@/lib/cloudinary'
import { sendPendingNotification, sendAdminAdmissionAlert } from '@/lib/notifications'
import { Gender } from '@prisma/client'
import { rateLimit } from '@/lib/rate-limit-db'

// ─── Validation Schema ────────────────────────────────────────────────────────

const applySchema = z.object({
  // ── Section 1: Student Identity ──────────────────────────────────────────
  firstName:    z.string().min(2, 'First name must be at least 2 characters'),
  lastName:     z.string().min(2, 'Last name must be at least 2 characters'),
  fullNameAr:   z.string().min(5, 'Full Arabic name is required'),
  fullNameEn:   z.string().optional(),
  fatherName:   z.string().min(2, "Father's name is required"),
  motherName:   z.string().optional(),
  dateOfBirth:  z.string().min(1, 'Date of birth is required').refine((v) => !Number.isNaN(new Date(v).getTime()), 'Invalid date of birth'),
  gender:       z.nativeEnum(Gender),
  bloodGroup:   z.string().optional(),
  nationality:  z.string().default('Egyptian'),

  // ── Section 2: Contact & Address ─────────────────────────────────────────
  address:          z.string().min(5, 'Full address is required'),
  city:             z.string().min(2, 'City is required'),
  phoneNumber:      z.string().min(10, 'Valid phone number is required'),
  emergencyContact: z.string().min(10, 'Emergency contact is required'),
  email:            z.string().email('Invalid email').optional().or(z.literal('')),

  // ── Section 3: Guardian / Parent Details ─────────────────────────────────
  passportPhotoBase64:  z.string().min(10, 'Personal photo is required'),
  guardianFirstName:    z.string().min(2, 'Guardian first name is required'),
  guardianLastName:     z.string().min(1, 'Guardian last name is required'),
  guardianPhoneNumber:  z.string().min(10, 'Guardian phone is required'),
  guardianEmail:        z.string().email().optional().or(z.literal('')),
  guardianRelationship: z.string().min(2, 'Relationship is required'),
  fatherPhoneNumber:    z.string().optional(),
  fatherOccupation:     z.string().optional(),
  motherPhoneNumber:    z.string().optional(),
  motherOccupation:     z.string().optional(),
  parentStatus: z.enum(['BOTH_ALIVE', 'FATHER_DECEASED', 'MOTHER_DECEASED', 'BOTH_DECEASED', 'DIVORCED']).default('BOTH_ALIVE'),

  // ── Section 4: School & Prior Background ──────────────────────────────────
  preferredCampusId: z.string().optional(),
  preferredBatchId: z.string().optional(),
  schoolName:                 z.string().optional(),
  regularSchoolGrade:         z.string().optional(),
  priorProgrammingExperience: z.string().optional(),

  // ── Section 5: Documents & Medical ───────────────────────────────────────
  medicalNotes:        z.string().optional(),  // Optional, never required
  hasSiblingAtAcademy: z.boolean().default(false),
  siblingName:         z.string().optional(),
  siblingClass:        z.string().optional(),

  // ── Section 6: Academic Preference ───────────────────────────────────────
  preferredShift:  z.enum(['MORNING', 'EVENING', 'NIGHT', '']).optional().or(z.literal('')),
  deliveryMode:    z.enum(['PHYSICAL', 'ONLINE', 'HYBRID']).default('PHYSICAL'),

  // ── Referral ─────────────────────────────────────────────────────────────
  sourceOfInfo:    z.string().optional(),

  // ── Declaration ──────────────────────────────────────────────────────────
  // WHY: Terms acceptance is a hard server-side requirement, not just UI.
  // The API rejects any submission where termsAccepted !== true.
  // Anti-spam honeypot: hidden in the page, only bots fill it.
  website: z.string().optional(),

  termsAccepted: z.literal(true, {
    errorMap: () => ({ message: 'You must accept the Terms & Conditions to proceed.' })
  }),
})

// ─── Anti-spam (public endpoint; no external service needed) ─────────────────
// Per-IP and global limits are both counted in the database, so they hold
// across server instances (lib/rate-limit-db.ts).
const PER_IP_LIMIT = 5
const PER_IP_WINDOW_MS = 60 * 60 * 1000
const GLOBAL_LIMIT = 30
const GLOBAL_WINDOW_MS = 10 * 60 * 1000

function ipOf(req: Request) {
  return req.headers.get('x-forwarded-for')?.split(',')[0].trim() || req.headers.get('x-real-ip') || 'unknown'
}

async function tooManyFromIp(ip: string) {
  return !(await rateLimit(`admissions-apply:ip:${ip}`, PER_IP_LIMIT, PER_IP_WINDOW_MS)).ok
}

const TOO_MANY = () =>
  NextResponse.json(
    { success: false, error: 'Too many applications right now. Please try again later or contact the administration.' },
    { status: 429 }
  )

// ─── POST /api/admissions/apply ───────────────────────────────────────────────
export async function POST(req: Request) {
  try {
    const body = await req.json()
    const validated = applySchema.parse(body)

    // Honeypot filled -> a bot. Pretend success, store nothing.
    if (validated.website) {
      return NextResponse.json({ success: true, message: 'Your application has been submitted successfully.' })
    }
    if (await tooManyFromIp(ipOf(req))) return TOO_MANY()
    const recentTotal = await prisma.admissionRequest.count({
      where: { createdAt: { gte: new Date(Date.now() - GLOBAL_WINDOW_MS) } },
    })
    if (recentTotal >= GLOBAL_LIMIT) return TOO_MANY()

    // ── Duplicate guard ─────────────────────────────────────────────────────
    // Same phone AND same first name = the same child. Siblings often share
    // the parent's phone, so phone alone used to reject the second sibling.
    const existingRequest = await prisma.admissionRequest.findFirst({
      where: { phoneNumber: validated.phoneNumber, firstName: validated.firstName.trim(), status: 'PENDING' },
    })
    if (existingRequest) {
      return NextResponse.json(
        { success: false, error: 'A pending application with this phone number already exists. Please contact the administration.' },
        { status: 400 }
      )
    }

    const existingStudent = await prisma.student.findFirst({
      where: { phoneNumber: validated.phoneNumber, firstName: validated.firstName.trim() },
    })
    if (existingStudent) {
      return NextResponse.json(
        { success: false, error: 'A student with this phone number is already enrolled at TechNova.' },
        { status: 400 }
      )
    }

    // ── Save personal photo ─────────────────────────────────────────────────
    let passportPhotoUrl: string | null = null
    try {
      const slug = `${validated.phoneNumber.replace(/\D/g, '')}-${Date.now()}`
      passportPhotoUrl = await uploadProfileImageToCloudinary(
        validated.passportPhotoBase64,
        'students',
        slug
      )
    } catch (imgErr: unknown) {
      const message = imgErr instanceof Error ? imgErr.message : 'Unknown image processing error.'
      if (!message.startsWith('Invalid image') && !message.startsWith('Image too large')) {
        console.error('[admissions.apply] Personal photo upload failed', imgErr)
        return NextResponse.json(
          { success: false, error: 'Photo upload failed. Please try again or contact administration.' },
          { status: 500 }
        )
      }
      return NextResponse.json(
        { success: false, error: `Photo error: ${message}` },
        { status: 400 }
      )
    }

    // ── Create AdmissionRequest ────────────────────────────────────────────

    const request = await prisma.admissionRequest.create({
      data: {
        // Identity
        firstName:    validated.firstName,
        lastName:     validated.lastName,
        fullNameAr:   validated.fullNameAr,
        fullNameEn:   validated.fullNameEn || null,
        fatherName:   validated.fatherName,
        motherName:   validated.motherName || null,
        dateOfBirth:  new Date(validated.dateOfBirth),
        gender:       validated.gender,
        bloodGroup:   validated.bloodGroup || null,
        nationality:  validated.nationality,

        // Contact
        address:          validated.address,
        city:             validated.city,
        phoneNumber:      validated.phoneNumber,
        emergencyContact: validated.emergencyContact,
        email:            validated.email || null,

        // Guardian
        passportPhotoUrl,
        guardianFirstName:    validated.guardianFirstName,
        guardianLastName:     validated.guardianLastName,
        guardianPhoneNumber:  validated.guardianPhoneNumber,
        guardianEmail:        validated.guardianEmail || null,
        guardianRelationship: validated.guardianRelationship,
        fatherPhoneNumber:    validated.fatherPhoneNumber || null,
        fatherOccupation:     validated.fatherOccupation || null,
        motherPhoneNumber:    validated.motherPhoneNumber || null,
        motherOccupation:     validated.motherOccupation || null,
        parentStatus:         validated.parentStatus,

        // School & prior background
        schoolName:                 validated.schoolName || null,
        regularSchoolGrade:         validated.regularSchoolGrade || null,
        priorProgrammingExperience: validated.priorProgrammingExperience || null,

        // Documents & medical
        medicalNotes:        validated.medicalNotes || null,
        hasSiblingAtAcademy: validated.hasSiblingAtAcademy,
        siblingName:         validated.siblingName || null,
        siblingClass:        validated.siblingClass || null,

        // Preference
        preferredCampusId: validated.preferredCampusId,
        preferredBatchId: validated.preferredBatchId,
        preferredShift: validated.preferredShift === '' ? null : validated.preferredShift ?? null,
        deliveryMode: validated.deliveryMode,

        // Referral
        sourceOfInfo: validated.sourceOfInfo || null,

        // Declaration — server-side timestamp
        termsAccepted:   true,
        termsAcceptedAt: new Date(),

        status: 'PENDING',
      },
    })

    // ── Notify admin / applicant ───────────────────────────────────────────
    try {
      if (request.email) {
        await sendPendingNotification(request.email, `${request.firstName} ${request.lastName}`)
      } else if (request.guardianEmail) {
        await sendPendingNotification(request.guardianEmail, `${request.firstName} ${request.lastName}`)
      }
      // Alert admin about new admission application
      await sendAdminAdmissionAlert(
        `${request.firstName} ${request.lastName}`,
        request.schoolName || 'Unspecified',
        request.id
      )
    } catch (_notifErr) {
      // Non-fatal — admission is already recorded; notification failure must not block response
      console.warn('[ADMISSIONS_APPLY] notification send failed', _notifErr)
    }

    return NextResponse.json({
      success: true,
      data: { id: request.id, createdAt: request.createdAt },
      message: 'Your application has been submitted successfully. TechNova will contact you shortly.',
    })

  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
          error: error.errors[0].message,
          fieldErrors: error.errors.map(e => ({
            field: e.path.join('.'),
            message: e.message,
          })),
        },
        { status: 400 }
      )
    }
    console.error('[ADMISSIONS_APPLY_POST]', error)
    return NextResponse.json(
      { success: false, error: 'Failed to submit application. Please try again later.' },
      { status: 500 }
    )
  }
}
