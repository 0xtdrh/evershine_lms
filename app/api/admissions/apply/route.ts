import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { writeFile, mkdir } from 'fs/promises'
import path from 'path'
import { uploadProfileImageToCloudinary } from '@/lib/cloudinary'
import { sendPendingNotification, sendAdminAdmissionAlert } from '@/lib/notifications'
import { Gender } from '@prisma/client'

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Saves a base64-encoded image (B-Form scan, previous result) to local disk.
 *
 * WHY local disk for these: Supporting documents are admin-reviewed once then
 * archived. They do not need CDN delivery. Hostinger's disk is persistent for
 * documents (unlike profile photos that appear in the UI on every page load).
 * Keeping them local avoids Cloudinary storage costs for large PDF/image files.
 *
 * TRADEOFF: Files are lost on a full server rebuild / disk wipe. Mitigation:
 * include public/uploads/ in Hostinger's backup schedule.
 */
async function saveDocumentToDisk(
  base64DataUrl: string,
  subDir: string,
  filePrefix: string
): Promise<string> {
  const base64Data = base64DataUrl.replace(/^data:image\/\w+;base64,/, '')
  const buffer = Buffer.from(base64Data, 'base64')

  // Magic-bytes validation (CWE-434)
  const magic = buffer.subarray(0, 4).toString('hex').toUpperCase()
  const isValidImage =
    magic.startsWith('FFD8')     || // JPEG
    magic.startsWith('89504E47') || // PNG
    magic.startsWith('47494638')    // GIF
  if (!isValidImage) {
    throw new Error('Invalid image format. Only JPEG, PNG and GIF are accepted.')
  }

  if (buffer.length > 5 * 1024 * 1024) {
    throw new Error('Document too large. Maximum allowed size is 5 MB.')
  }

  const uploadDir = path.join(process.cwd(), `public/uploads/${subDir}`)
  await mkdir(uploadDir, { recursive: true })

  const ext = magic.startsWith('89504E47') ? 'png' : 'jpg'
  const fileName = `${filePrefix}-${Date.now()}.${ext}`
  await writeFile(path.join(uploadDir, fileName), buffer)

  return `/uploads/${subDir}/${fileName}`
}


// ─── Validation Schema ────────────────────────────────────────────────────────

const applySchema = z.object({
  // ── Section 1: Student Identity ──────────────────────────────────────────
  firstName:    z.string().min(2, 'First name must be at least 2 characters'),
  lastName:     z.string().min(2, 'Last name must be at least 2 characters'),
  fullNameAr:   z.string().min(5, 'Full Arabic name is required'),
  fullNameEn:   z.string().optional(),
  fatherName:   z.string().min(2, "Father's name is required"),
  motherName:   z.string().optional(),
  dateOfBirth:  z.string().min(1, 'Date of birth is required'),
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
  termsAccepted: z.literal(true, {
    errorMap: () => ({ message: 'You must accept the Terms & Conditions to proceed.' })
  }),
})

// ─── POST /api/admissions/apply ───────────────────────────────────────────────
export async function POST(req: Request) {
  try {
    const body = await req.json()
    const validated = applySchema.parse(body)

    // ── Duplicate guard ─────────────────────────────────────────────────────
    const existingRequest = await prisma.admissionRequest.findFirst({
      where: { phoneNumber: validated.phoneNumber, status: 'PENDING' },
    })
    if (existingRequest) {
      return NextResponse.json(
        { success: false, error: 'A pending application with this phone number already exists. Please contact the administration.' },
        { status: 400 }
      )
    }

    const existingStudent = await prisma.student.findFirst({
      where: { phoneNumber: validated.phoneNumber },
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
