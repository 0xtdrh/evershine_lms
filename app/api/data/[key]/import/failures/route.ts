/**
 * POST /api/data/[key]/import/failures { rows: [{ row, values, reason }], lang } — phase 6: the rows that were not
 * imported as an Excel file (reason first), to fix and upload again.
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { errors } from '@/lib/api-response'
import { exchangeContext, fileResponse, stamp } from '@/lib/data-exchange/http'
import { failuresWorkbook, toBuffer } from '@/lib/data-exchange/excel'

const schema = z.object({
  rows: z.array(z.object({ row: z.number().int(), values: z.record(z.unknown()), reason: z.string().max(2000) })).min(1).max(2000),
  lang: z.enum(['ar', 'en']).optional(),
})

export async function POST(request: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const ctx = await exchangeContext((await params).key)
  if ('error' in ctx) return ctx.error === 401 ? errors.unauthorized() : errors.notFound('Table')
  if (!ctx.rights.import) return errors.forbidden()
  let body: unknown
  try { body = await request.json() } catch { return errors.badRequest('Invalid JSON') }
  const parsed = schema.safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)
  const d = parsed.data as { rows: { row: number; values: Record<string, unknown>; reason: string }[]; lang?: 'ar' | 'en' }
  const buf = await toBuffer(await failuresWorkbook(ctx.d, d.rows, d.lang ?? 'ar'))
  return fileResponse(buf, `TechNova-${ctx.d.key}-to-fix-${stamp()}.xlsx`)
}
