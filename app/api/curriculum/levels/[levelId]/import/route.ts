/** LMS L1: import an exported curriculum file as a new DRAFT version of this level. */

import { NextRequest } from 'next/server'
import { createdResponse } from '@/lib/api-response'
import { importEdition, type ImportFile } from '@/lib/curriculum/engine'
import { curriculumViewer, outcomeError, readJson } from '@/lib/curriculum/api'

export async function POST(request: NextRequest, { params }: { params: Promise<{ levelId: string }> }) {
  const { levelId } = await params
  const { v, err } = await curriculumViewer()
  if (err) return err
  const { body, err: bad } = await readJson(request)
  if (bad) return bad
  const o = await importEdition(v!, levelId, body as ImportFile)
  if (!o.ok) return outcomeError(o)
  return createdResponse(o.value, 'Imported as a new draft')
}
