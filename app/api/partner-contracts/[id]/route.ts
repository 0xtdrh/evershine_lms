/** M1: PATCH /api/partner-contracts/[id] (edit / renew) · DELETE (with its files). */

import { NextRequest } from 'next/server'
import type { Role } from '@prisma/client'
import { errors } from '@/lib/api-response'
import { requireSession, requirePermission } from '@/lib/academic/api-helpers'
import { deleteContract, updateContract } from '@/lib/partners/engine'
import { contractSchema } from '@/lib/partners/validation'
import { outcome } from '@/lib/partners/http'

type P = { params: Promise<{ id: string }> }

export async function PATCH(request: NextRequest, { params }: P) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const denied = requirePermission(session.user.role as Role, 'partners', 'update')
  if (denied) return denied
  const parsed = contractSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  return outcome(await updateContract(session.user.id, (await params).id, parsed.data as never), 'Saved')
}

export async function DELETE(_r: NextRequest, { params }: P) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const denied = requirePermission(session.user.role as Role, 'partners', 'delete')
  if (denied) return denied
  return outcome(await deleteContract(session.user.id, (await params).id), 'Deleted')
}
