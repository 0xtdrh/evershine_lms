/**
 * PUT /api/curriculum/sessions/[id]/gate — 2026-10-18: what a student must finish in this session before the next one
 * opens. Body { gate: { content?, homework?: SUBMITTED | GRADED | null, minHomeworkPct?, quiz?, minQuizPct? } | null }.
 * A setting, so it also works on a published version (curriculum editors / approvers).
 */

import { NextRequest } from 'next/server'
import { successResponse } from '@/lib/api-response'
import { setSessionGate } from '@/lib/curriculum/engine'
import { curriculumViewer, outcomeError, readJson } from '@/lib/curriculum/api'
import { parseGate } from '@/lib/lms/gate'

type Ctx = { params: Promise<{ id: string }> }

export async function PUT(request: NextRequest, { params }: Ctx) {
  const { id } = await params
  const { v, err } = await curriculumViewer()
  if (err) return err
  const { body, err: bad } = await readJson(request)
  if (bad) return bad
  const gate = parseGate((body as { gate?: unknown } | null)?.gate)
  const o = await setSessionGate(v!, id, gate)
  if (!o.ok) return outcomeError(o)
  return successResponse({ gate }, 'Saved')
}
