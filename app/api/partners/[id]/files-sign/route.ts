/** M1: POST /api/partners/[id]/files-sign — signature for a private upload into the contract folder of this partner. */

import type { Role } from '@prisma/client'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession, requirePermission } from '@/lib/academic/api-helpers'
import { prisma } from '@/lib/prisma'
import { contractUploadSignature } from '@/lib/partners/engine'

export async function POST(_r: Request, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const denied = requirePermission(session.user.role as Role, 'partners', 'update')
  if (denied) return denied
  const { id } = await params
  if (!(await prisma.partner.count({ where: { id } }))) return errors.notFound('Partner')
  try {
    return successResponse(contractUploadSignature(id))
  } catch {
    return errors.badRequest('File storage is not set up')
  }
}
