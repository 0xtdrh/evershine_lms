/** P1: POST { kind: BOOKLET | PASSPORT_PDF | TRANSCRIPT } — branch staff log a print (copy number; booklet price from settings). */

import type { Role } from '@prisma/client'
import { auth } from '@/lib/auth'
import { errors, createdResponse } from '@/lib/api-response'
import { logPrint, PRINT_KINDS } from '@/lib/passport/engine'

export async function POST(req: Request, { params }: { params: Promise<{ studentId: string }> }) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  const { studentId } = await params
  const body = (await req.json().catch(() => null)) as { kind?: string } | null
  const kind = body?.kind as (typeof PRINT_KINDS)[number]
  if (!PRINT_KINDS.includes(kind)) return errors.badRequest('Unknown print')
  const r = await logPrint({ id: session.user.id, role: session.user.role as Role, campusId: session.user.campusId }, studentId, kind)
  if (!r.ok) return errors.forbidden(r.message)
  return createdResponse(r.value)
}
