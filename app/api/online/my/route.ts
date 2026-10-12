/** L5: GET [?s=<studentId> for a parent] — today's online sessions of the student with the Join state. */

import { successResponse } from '@/lib/api-response'
import { onlineViewer } from '@/lib/online/viewer'
import { myOnlineSessions } from '@/lib/online/engine'

export async function GET(req: Request) {
  const v = await onlineViewer(new URL(req.url).searchParams.get('s'))
  if (v.err) return v.err
  return successResponse(await myOnlineSessions(v.studentId!))
}
