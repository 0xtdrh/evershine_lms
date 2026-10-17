/**
 * POST /api/data/[key]/import/commit { rows: [{ row, values }], fileName?, logId? } — phase 6, step 2: save checked
 * rows (at most 10 per call; the page sends them in small batches and shows the progress). Each row goes through the
 * same API the screen uses. Ids of branches / groups / levels are checked again against the person's places.
 * Returns each row's result and the log id to send with the next batch.
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { errors, successResponse } from '@/lib/api-response'
import { exchangeContext, logExchange } from '@/lib/data-exchange/http'
import { importRow, refLists } from '@/lib/data-exchange/datasets'
import { importFields } from '@/lib/data-exchange/registry'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const schema = z.object({
  rows: z.array(z.object({ row: z.number().int().min(1), values: z.record(z.unknown()) })).min(1).max(10),
  fileName: z.string().max(200).optional(),
  logId: z.string().max(40).optional().nullable(),
})

export async function POST(request: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const ctx = await exchangeContext((await params).key)
  if ('error' in ctx) return ctx.error === 401 ? errors.unauthorized() : errors.notFound('Table')
  if (!ctx.rights.import) return errors.forbidden()
  let body: unknown
  try { body = await request.json() } catch { return errors.badRequest('Invalid JSON') }
  const parsed = schema.safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)
  const { rows, fileName, logId } = parsed.data as { rows: { row: number; values: Record<string, unknown> }[]; fileName?: string; logId?: string | null }

  // the ref ids must still be inside the person's places (the page could have been changed by hand)
  const { refs } = await refLists(ctx.user)
  const refFields = importFields(ctx.d).filter((f) => f.type === 'ref' && f.ref)
  const ictx = { user: ctx.user, origin: request.nextUrl.origin, cookie: request.headers.get('cookie') ?? '' }
  const results: { row: number; ok: boolean; reason?: string; note?: string }[] = []
  for (const r of rows) {
    const bad = refFields.find((f) => r.values[f.key] !== undefined && r.values[f.key] !== null && !(refs[f.ref!] ?? []).some((x) => x.id === r.values[f.key]))
    if (bad) { results.push({ row: r.row, ok: false, reason: `${bad.en} is not in your places / ${bad.ar} مش في أماكنك` }); continue }
    try {
      const out = await importRow(ctx.d.key, ictx, r.values)
      if (out.ok) results.push({ row: r.row, ok: true, note: (out as { note?: string }).note })
      else results.push({ row: r.row, ok: false, reason: (out as { reason: string }).reason })
    } catch (err) {
      console.error('[DATA_IMPORT]', ctx.d.key, err)
      results.push({ row: r.row, ok: false, reason: 'Unexpected error — try this row again / خطأ غير متوقع — جرّب السطر ده تاني' })
    }
  }
  const created = results.filter((x) => x.ok).length
  const failed = results.length - created
  let id = logId ?? null
  if (id) {
    await prisma.dataExchangeLog.updateMany({ where: { id, userId: ctx.user.id, kind: 'IMPORT' }, data: { rows: { increment: results.length }, created: { increment: created }, failed: { increment: failed } } })
  } else {
    id = (await logExchange(ctx.user, ctx.d, 'IMPORT', { format: 'xlsx', fileName, rows: results.length, created, failed }))?.id ?? null
  }
  return successResponse({ results, created, failed, logId: id })
}
