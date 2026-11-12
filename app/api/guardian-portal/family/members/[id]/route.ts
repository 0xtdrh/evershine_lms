/** PATCH / DELETE /api/guardian-portal/family/members/[id] — six phases 1-A: edit or remove a child not registered yet. */

import { NextRequest } from 'next/server'
import { errors, successResponse } from '@/lib/api-response'
import { memberSchema } from '@/lib/accounts/rules'
import { removeMember, updateMember } from '@/lib/accounts/engine'
import { accountError } from '@/lib/accounts/http'
import { familySession } from '@/lib/accounts/portal'

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const f = await familySession()
  if (f.error) return f.error
  const parsed = memberSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  try {
    return successResponse(await updateMember(f.guardian.id, (await params).id, parsed.data))
  } catch (e) {
    return accountError(e)
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const f = await familySession()
  if (f.error) return f.error
  try {
    await removeMember(f.guardian.id, (await params).id)
    return successResponse({ ok: true })
  } catch (e) {
    return accountError(e)
  }
}
