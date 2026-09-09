import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { auth } from '@/lib/auth'
import { checkPermission, CAMPUS_SCOPED_ROLES } from '@/lib/rbac'
import type { Role } from '@prisma/client'

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }
    const role = session.user.role as Role
    if (!checkPermission(role, 'admissions', 'delete')) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params;

    const request = await prisma.admissionRequest.findUnique({ where: { id } })
    if (!request) {
      return NextResponse.json({ success: false, error: 'Request not found' }, { status: 404 })
    }
    if (CAMPUS_SCOPED_ROLES.includes(role)) {
      if (!session.user.campusId || request.preferredCampusId !== session.user.campusId) {
        return NextResponse.json({ success: false, error: 'You can delete admissions only for their assigned campus.' }, { status: 403 })
      }
    }

    await prisma.admissionRequest.delete({
      where: { id }
    })

    // Audit Log
    await prisma.auditLog.create({
      data: {
        userId: session.user.id,
        action: 'DELETE',
        entityType: 'ADMISSION',
        entityId: id,
        changes: {
          firstName: request.firstName,
          lastName: request.lastName,
          phoneNumber: request.phoneNumber,
          reason: 'Manual deletion by admin'
        }
      }
    })

    return NextResponse.json({
      success: true,
      message: 'Admission request deleted successfully'
    })
  } catch (error) {
    console.error('[ADMISSIONS_DELETE]', error)
    return NextResponse.json({ success: false, error: 'Failed to delete admission request' }, { status: 500 })
  }
}
