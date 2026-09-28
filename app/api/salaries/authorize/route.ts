import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { auth } from '@/lib/auth'
import { checkPermission } from '@/lib/rbac'
import { z } from 'zod'

// The approver is always the logged-in user; an approverId sent by the client is ignored.
const schema = z.object({
  salarySlipId: z.string().min(1),
  reason: z.string().trim().max(500).optional().nullable(),
})

export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    // SECURITY: previously any logged-in user could mark a salary slip APPROVED + PAID.
    if (!checkPermission(session.user.role, 'salaries', 'approve')) {
      return NextResponse.json({ success: false, error: 'You do not have permission to authorize salaries' }, { status: 403 })
    }
    const approverId = session.user.id

    const body = await request.json()
    const parsed = schema.safeParse(body)
    if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.flatten() }, { status: 400 })

    const slip = await prisma.salarySlip.findUnique({ where: { id: parsed.data.salarySlipId } })
    if (!slip) return NextResponse.json({ success: false, error: 'Salary slip not found' }, { status: 404 })

    if (slip.issuedById === approverId) {
      return NextResponse.json({ success: false, error: 'Self-authorization is not allowed' }, { status: 400 })
    }

    const issuer = slip.issuedById
      ? await prisma.user.findUnique({ where: { id: slip.issuedById }, select: { role: true } })
      : null

    const authorization = await prisma.salaryAuthorization.create({
      data: {
        salarySlipId: slip.id,
        issuerId: slip.issuedById ?? approverId,
        approverId,
        issuerRole: issuer?.role ?? 'UNKNOWN',
        approverRole: session.user.role,
        status: 'APPROVED',
        reason: parsed.data.reason ?? null,
      },
    })

    await prisma.salarySlip.update({
      where: { id: slip.id },
      data: {
        approvalStatus: 'APPROVED',
        approvedById: approverId,
        approvedAsRole: session.user.role,
        approvalNote: parsed.data.reason ?? null,
        status: 'PAID',
        paymentDate: new Date(),
        paymentReference: `AUTH-${authorization.id.slice(0, 8).toUpperCase()}`,
      },
    })

    return NextResponse.json({ success: true, data: authorization })
  } catch (error) {
    console.error('[SALARY_AUTHORIZE_POST]', error)
    return NextResponse.json({ success: false, error: 'Failed to authorize salary' }, { status: 500 })
  }
}
