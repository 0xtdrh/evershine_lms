/**
 * POST /api/data/[key]/import (multipart: file) — phase 6, step 1: read the Excel file and check every row
 * (types, required, choices, names of branches / groups / levels inside the person's places). Nothing is saved.
 * Returns the rows with their problems so the person sees everything before importing.
 */

import { NextRequest } from 'next/server'
import { errors, successResponse } from '@/lib/api-response'
import { exchangeContext } from '@/lib/data-exchange/http'
import { refLists } from '@/lib/data-exchange/datasets'
import { readWorkbook } from '@/lib/data-exchange/excel'
import { readSheet } from '@/lib/data-exchange/parse'
import { importFields } from '@/lib/data-exchange/registry'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MAX_BYTES = 5 * 1024 * 1024
const MAX_ROWS = 2000

export async function POST(request: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const ctx = await exchangeContext((await params).key)
  if ('error' in ctx) return ctx.error === 401 ? errors.unauthorized() : errors.notFound('Table')
  if (!ctx.rights.import) return errors.forbidden()
  let file: File | null = null
  try { file = (await request.formData()).get('file') as File | null } catch { /* not multipart */ }
  if (!file || typeof file.arrayBuffer !== 'function') return errors.badRequest('Attach the Excel file')
  if (file.size > MAX_BYTES) return errors.badRequest('The file is larger than 5 MB')
  const book = await readWorkbook(await file.arrayBuffer(), ctx.d)
  if (!book) return errors.badRequest('This is not an Excel (.xlsx) file — download the template and fill it')
  if (book.headerRowIndex < 0) return errors.badRequest('The columns were not found — use the template (the first line must stay as it is)')
  const { refs } = await refLists(ctx.user)
  const parsed = readSheet(book.rows, importFields(ctx.d), refs, book.headerRowIndex)
  if (parsed.rows.length > MAX_ROWS) return errors.badRequest(`At most ${MAX_ROWS} rows per file — split it`)
  return successResponse({
    fileName: file.name,
    rows: parsed.rows,
    valid: parsed.rows.filter((r) => !r.errors.length).length,
    missingColumns: parsed.missingColumns.map((f) => ({ key: f.key, en: f.en, ar: f.ar })),
    unknownColumns: parsed.unknownColumns,
  })
}
