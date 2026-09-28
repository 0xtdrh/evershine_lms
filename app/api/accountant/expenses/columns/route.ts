import { auth } from '@/lib/auth'
import { checkPermission } from '@/lib/rbac'
import { errors, successResponse } from '@/lib/api-response'
import { getExpenseColumnSupport } from '@/lib/accounting/expense-columns'

export async function GET() {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()

  const role = session.user.role
  if (!checkPermission(session.user.role, 'expenses', 'read')) {
    return errors.forbidden('Only finance staff can view expense metadata settings')
  }

  const supportedColumns = await getExpenseColumnSupport()
  return successResponse(supportedColumns)
}
