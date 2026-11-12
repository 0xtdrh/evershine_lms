/** POST /api/guardian-portal/family/members — six phases 1-A: the family adds a child (before any booking). */

import { NextRequest } from 'next/server'
import { createdResponse, errors } from '@/lib/api-response'
import { prisma } from '@/lib/prisma'
import { memberSchema } from '@/lib/accounts/rules'
import { addMember } from '@/lib/accounts/engine'
import { accountError } from '@/lib/accounts/http'
import { familySession } from '@/lib/accounts/portal'

export async function POST(request: NextRequest) {
  const f = await familySession()
  if (f.error) return f.error
  const parsed = memberSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  if ((await prisma.familyMember.count({ where: { guardianId: f.guardian.id } })) >= 12) return errors.badRequest('Too many children on one account · عدد كبير على حساب واحد')
  try {
    return createdResponse(await addMember(f.guardian.id, parsed.data))
  } catch (e) {
    return accountError(e)
  }
}
