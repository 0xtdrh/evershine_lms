/** LMS L1: download a curriculum version as a JSON file (to back it up or import it into another level). */

import { NextRequest, NextResponse } from 'next/server'
import { errors } from '@/lib/api-response'
import { exportEdition } from '@/lib/curriculum/engine'
import { curriculumViewer } from '@/lib/curriculum/api'

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { v, err } = await curriculumViewer()
  if (err) return err
  const data = await exportEdition(v!, id)
  if (!data) return errors.notFound('Version')
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="curriculum-v${data.edition.number}.json"` },
  })
}
