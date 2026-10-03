/**
 * GET /api/students/[id]/reports — phase C: the student's monthly and level reports.
 * GET ?kind=MONTHLY|LEVEL&group=<classSectionId> — one report.
 * Staff (branch), the student's instructors, parents and the student.
 */

import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { errors, successResponse } from '@/lib/api-response'
import { studentViewer } from '@/lib/students/access'
import { listReports, monthlyReport, levelReport } from '@/lib/reports/student-reports'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  const { id } = await params
  if (!(await studentViewer(session.user, id))) return errors.forbidden()
  const sp = new URL(request.url).searchParams
  const kind = sp.get('kind')
  const group = sp.get('group')
  if (!kind) return successResponse(await listReports(id))
  if (!group) return errors.badRequest('group is required')
  const report = kind === 'LEVEL' ? await levelReport(id, group) : await monthlyReport(id, group)
  if (!report) return errors.notFound('Report')
  return successResponse(report)
}
