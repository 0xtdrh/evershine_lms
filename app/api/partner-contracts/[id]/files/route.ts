/** M1: POST /api/partner-contracts/[id]/files — register a contract photo / PDF uploaded privately (files-sign). */

import { NextRequest } from 'next/server'
import type { Role } from '@prisma/client'
import { errors } from '@/lib/api-response'
import { requireSession, requirePermission } from '@/lib/academic/api-helpers'
import { addContractFile } from '@/lib/partners/engine'
import { fileSchema } from '@/lib/partners/validation'
import { outcome } from '@/lib/partners/http'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const denied = requirePermission(session.user.role as Role, 'partners', 'update')
  if (denied) return denied
  const parsed = fileSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  return outcome(await addContractFile(session.user.id, (await params).id, parsed.data as never), 'File added')
}
