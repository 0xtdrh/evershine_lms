import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { auth } from '@/lib/auth'
import { z } from 'zod'
import { sendCancellationNotification } from '@/lib/notifications'
import { checkPermission, CAMPUS_SCOPED_ROLES } from '@/lib/rbac'
import type { Role } from '@prisma/client'

const declineSchema = z.object({
  reason: z.string().optional(),
})

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }
    const role = session.user.role as Role
    if (!checkPermission(role, 'admissions', 'update')) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params;
    const body = await req.json()
    const { reason } = declineSchema.parse(body)

    const request = await prisma.admissionRequest.findUnique({ where: { id } })
    if (!request) {
      return NextResponse.json({ success: false, error: 'Request not found' }, { status: 404 })
    }
    if (request.status !== 'PENDING') {
      return NextResponse.json({ success: false, error: 'Request is already processed' }, { status: 400 })
    }
    if (CAMPUS_SCOPED_ROLES.includes(role)) {
      if (!session.user.campusId || request.preferredCampusId !== session.user.campusId) {
        return NextResponse.json({ success: false, error: 'You can decline admissions only for your assigned campus.' }, { status: 403 })
      }
    }

    // Mark Request as Declined
    const updatedRequest = await prisma.admissionRequest.update({
      where: { id },
      data: {
        status: 'DECLINED',
        reviewedBy: session.user.id,
        adminComments: reason
      }
    })

    // Send Cancellation Notification
    if (updatedRequest.email) {
      await sendCancellationNotification(updatedRequest.email, `${updatedRequest.firstName} ${updatedRequest.lastName}`, reason)
    } else if (updatedRequest.guardianEmail) {
      await sendCancellationNotification(updatedRequest.guardianEmail, `${updatedRequest.firstName} ${updatedRequest.lastName}`, reason)
    }

    // Audit Log
    await prisma.auditLog.create({
      data: {
        userId: session.user.id,
        action: 'DECLINE',
        entityType: 'Admission',
        entityId: id,
        changes: {
          details: `Declined admission for ${updatedRequest.firstName} ${updatedRequest.lastName}. Reason: ${reason || 'Not specified'}`
        }
      }
    })

    return NextResponse.json({
      success: true,
      message: 'Admission request declined successfully'
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ success: false, error: 'Validation failed' }, { status: 400 })
    }
    console.error('[ADMISSIONS_DECLINE]', error)
    return NextResponse.json({ success: false, error: 'Failed to decline admission' }, { status: 500 })
  }
}
