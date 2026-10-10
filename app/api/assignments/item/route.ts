/**
 * LMS L3: one assignment for a student. GET ?g=<groupId>&b=<blockId>[&s=<childId> for parents].
 * PUT { groupId, blockId, studentId?, text?, links?, files?, answers?, submit } — save a draft or hand in.
 * Parents may hand in only for young children when the policy allows it.
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { errors, errorResponse, successResponse } from '@/lib/api-response'
import { saveSubmission, studentAssignment } from '@/lib/assignments/engine'
import { portalLessonViewer } from '@/lib/lms/api'

const outcomeError = (o: { code?: string; message?: string }) =>
  o.code === 'NOT_FOUND' ? errors.notFound('Assignment')
    : o.code === 'FORBIDDEN' ? errors.forbidden(o.message)
      : ['LOCKED', 'CLOSED', 'NO_RESUBMIT', 'NO_ATTEMPTS'].includes(o.code ?? '') ? errorResponse(o.code!, o.message ?? 'Not allowed', 409)
        : errors.badRequest(o.message ?? 'Invalid')

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams
  const { v, err } = await portalLessonViewer(q.get('s'))
  if (err) return err
  const g = q.get('g'), b = q.get('b')
  if (!g || !b) return errors.badRequest('g and b are required')
  const r = (await studentAssignment(v!.studentId, g, b)) as { ok: boolean; code?: string; message?: string; value?: object }
  if (!r.ok) return outcomeError(r)
  return successResponse({ ...r.value, asParent: v!.asParent })
}

const fileSchema = z.object({ publicId: z.string().min(1).max(300), resourceType: z.enum(['image', 'video', 'raw']), format: z.string().max(10).optional(), bytes: z.number().optional(), originalName: z.string().max(200).optional() })

export async function PUT(request: NextRequest) {
  let body: unknown
  try { body = await request.json() } catch { return errors.badRequest('Invalid JSON') }
  const parsed = z.object({
    groupId: z.string().min(1), blockId: z.string().min(1), studentId: z.string().nullish(),
    text: z.string().max(20000).nullish(), links: z.array(z.string().max(1000)).max(5).optional(),
    files: z.array(fileSchema).max(10).optional(),
    answers: z.record(z.string(), z.union([z.string().max(500), z.number(), z.array(z.string().max(100)).max(10), z.null()])).optional(),
    code: z.string().max(100_000).nullish(),
    codeResults: z.array(z.object({ id: z.string().max(40), passed: z.boolean(), output: z.string().max(2000).optional() })).max(30).optional(),
    submit: z.boolean(),
  }).safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)
  const d = parsed.data
  const { v, err } = await portalLessonViewer(d.studentId ?? null)
  if (err) return err
  if (v!.asParent) {
    const ctx = (await studentAssignment(v!.studentId, d.groupId!, d.blockId!)) as { ok: boolean; value?: { parentMaySubmit: boolean } }
    if (!ctx.ok || !ctx.value?.parentMaySubmit) return errors.forbidden('Parents can hand in only for young children')
  }
  const o = await saveSubmission(v!.studentId, d.groupId!, d.blockId!, { text: d.text, links: d.links, files: d.files as never, answers: d.answers as never, code: d.code, codeResults: d.codeResults as never }, d.submit!, v!.userId)
  if (!o.ok) return outcomeError(o)
  return successResponse(o.value, d.submit ? 'Handed in' : 'Draft saved')
}
