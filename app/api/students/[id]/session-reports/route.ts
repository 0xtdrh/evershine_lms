/** R1: GET — the student's session reports (parents / the student: sent only; staff: groups they may read). */

import type { Role } from '@prisma/client'
import { auth } from '@/lib/auth'
import { errors, successResponse } from '@/lib/api-response'
import { studentViewer } from '@/lib/students/access'
import { canViewGroupReports, studentReportEntries } from '@/lib/session-reports/engine'

export const dynamic = 'force-dynamic'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  const { id } = await params
  const user = { id: session.user.id, role: session.user.role as Role, campusId: session.user.campusId }
  const viewer = await studentViewer(user, id)
  if (!viewer) return errors.forbidden()
  const family = viewer === 'PARENT' || viewer === 'STUDENT'
  const rows = await studentReportEntries(id, !family)
  if (family) return successResponse(rows)
  const allowed = new Map<string, boolean>()
  const out = []
  for (const r of rows) {
    if (!allowed.has(r.groupId)) allowed.set(r.groupId, await canViewGroupReports(user, r.groupId))
    if (allowed.get(r.groupId)) out.push(r)
  }
  return successResponse(out)
}
