import { allowsCampus } from '@/lib/places/rules'
import { loadPlaces } from '@/lib/places/server'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { auth } from '@/lib/auth'
import { checkPermission } from '@/lib/rbac'
import { errors, successResponse } from '@/lib/api-response'

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user) return errors.unauthorized()
    if (!checkPermission(session.user.role, 'profit_loss', 'delete')) {
      return errors.forbidden('Only finance staff can delete P&L statements')
    }

    const { id } = await params
    const statement = await prisma.profitLossStatement.findUnique({ where: { id } })
    if (!statement) return errors.notFound('P&L statement not found')

    // Role scoping: accountants can only delete statements for their campus (unless they have no campus restriction)
    {
      // M0: statements of the person's places (a company-wide one needs every place)
      const pl = await loadPlaces(session.user)
      if (statement.campusId ? !allowsCampus(pl, statement.campusId) : !pl.all) {
        return errors.forbidden('Cannot delete a statement for a different campus')
      }
    }

    await prisma.$transaction(async (tx) => {
      // Remove reserve ledger entries tied to this P&L (audit preserved separately)
      await tx.reserveFundLedger.deleteMany({ where: { profitLossId: id } })
      await tx.profitLossStatement.delete({ where: { id } })
      await tx.auditLog.create({ data: { userId: session.user.id, action: 'DELETE', entityType: 'ProfitLossStatement', entityId: id, changes: {} } })
    })

    return successResponse({ id }, 'P&L statement deleted')
  } catch (err) {
    console.error('[PL_DELETE]', err)
    return errors.internal()
  }
}
