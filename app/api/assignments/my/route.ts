/** LMS L3: "My assignments" — student (own) or parent (?s=<childId>, read-only list) — status, due date, grade. */

import { NextRequest } from 'next/server'
import { successResponse } from '@/lib/api-response'
import { studentAssignments } from '@/lib/assignments/engine'
import { portalLessonViewer } from '@/lib/lms/api'

export async function GET(request: NextRequest) {
  const { v, err } = await portalLessonViewer(request.nextUrl.searchParams.get('s'))
  if (err) return err
  return successResponse({ asParent: v!.asParent, studentId: v!.studentId, groups: await studentAssignments(v!.studentId) })
}
