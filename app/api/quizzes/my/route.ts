/** LMS L4: "My quizzes" — student (own) or parent (?s=<childId>): tries and scores of the open quizzes. */

import { NextRequest } from 'next/server'
import { successResponse } from '@/lib/api-response'
import { studentQuizzes } from '@/lib/quizzes/engine'
import { portalLessonViewer } from '@/lib/lms/api'

export async function GET(request: NextRequest) {
  const { v, err } = await portalLessonViewer(request.nextUrl.searchParams.get('s'))
  if (err) return err
  return successResponse({ asParent: v!.asParent, studentId: v!.studentId, groups: await studentQuizzes(v!.studentId) })
}
