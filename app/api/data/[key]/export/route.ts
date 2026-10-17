/**
 * GET /api/data/[key]/export?format=xlsx|json&lang=ar|en&campusId&from&to&groupId&status — phase 6.
 * xlsx = the branded Excel file; json = rows for the printable PDF page (/reports/data/[key]). Only the person's places.
 * Logged in DataExchangeLog.
 */

import { NextRequest } from 'next/server'
import { errors, successResponse } from '@/lib/api-response'
import { exchangeContext, fileResponse, logExchange, stamp } from '@/lib/data-exchange/http'
import { exportRows } from '@/lib/data-exchange/datasets'
import { exportWorkbook, toBuffer } from '@/lib/data-exchange/excel'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const DATE = /^\d{4}-\d{2}-\d{2}$/

export async function GET(request: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const ctx = await exchangeContext((await params).key)
  if ('error' in ctx) return ctx.error === 401 ? errors.unauthorized() : errors.notFound('Table')
  if (!ctx.rights.export) return errors.forbidden()
  const sp = request.nextUrl.searchParams
  const pick = (k: string) => sp.get(k)?.trim() || null
  const filters = {
    campusId: pick('campusId'), groupId: pick('groupId'), status: pick('status'),
    from: DATE.test(pick('from') ?? '') ? pick('from') : null, to: DATE.test(pick('to') ?? '') ? pick('to') : null,
  }
  const rows = await exportRows(ctx.d.key, ctx.user, filters)
  const format = sp.get('format') === 'json' ? 'json' : 'xlsx'
  const lang = sp.get('lang') === 'en' ? 'en' : 'ar'
  await logExchange(ctx.user, ctx.d, 'EXPORT', { format: format === 'json' ? (sp.get('for') === 'pdf' ? 'pdf' : 'json') : 'xlsx', rows: rows.length })
  if (format === 'json') return successResponse({ rows, count: rows.length, filters })
  const subtitle = [filters.from && `from ${filters.from}`, filters.to && `to ${filters.to}`, filters.status].filter(Boolean).join(' · ') || undefined
  const buf = await toBuffer(await exportWorkbook(ctx.d, rows, lang, subtitle))
  return fileResponse(buf, `TechNova-${ctx.d.key}-${stamp()}.xlsx`)
}
