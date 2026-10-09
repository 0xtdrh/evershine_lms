/** LMS L1: Track > Course > Level tree with the curriculum status of every level (only levels the viewer may see). */

import { successResponse } from '@/lib/api-response'
import { curriculumTree } from '@/lib/curriculum/engine'
import { curriculumViewer } from '@/lib/curriculum/api'

export async function GET() {
  const { v, err } = await curriculumViewer()
  if (err) return err
  return successResponse({ tree: await curriculumTree(v!), can: { edit: v!.canEdit, approve: v!.canApprove, delete: v!.canDelete } })
}
