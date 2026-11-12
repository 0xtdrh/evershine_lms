/** GET /api/guardian-portal/family — six phases 1-A: the family account, its people (children + registered students), settings. */

import { prisma } from '@/lib/prisma'
import { successResponse } from '@/lib/api-response'
import { familyOf, getAccountsSettings } from '@/lib/accounts/engine'
import { familySession } from '@/lib/accounts/portal'

export async function GET() {
  const f = await familySession()
  if (f.error) return f.error
  const [people, settings, user] = await Promise.all([
    familyOf(f.guardian.id), getAccountsSettings(),
    prisma.user.findUnique({ where: { id: f.session.user.id }, select: { emailVerified: true } }),
  ])
  return successResponse({
    account: { ...f.guardian, emailVerified: !!user?.emailVerified },
    people, settings: { unsuitable: settings.unsuitable, emailCheck: settings.emailCheck },
  })
}
