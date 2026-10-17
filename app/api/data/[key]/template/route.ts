/**
 * GET /api/data/[key]/template?lang=ar|en — phase 6: the Excel template to fill (bilingual headers, dropdowns with the
 * person's own branches / groups / levels, instructions sheet with the logo).
 */

import { NextRequest } from 'next/server'
import { errors } from '@/lib/api-response'
import { exchangeContext, fileResponse } from '@/lib/data-exchange/http'
import { refLists } from '@/lib/data-exchange/datasets'
import { templateWorkbook, toBuffer } from '@/lib/data-exchange/excel'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const ctx = await exchangeContext((await params).key)
  if ('error' in ctx) return ctx.error === 401 ? errors.unauthorized() : errors.notFound('Table')
  if (!ctx.rights.import) return errors.forbidden()
  const lang = request.nextUrl.searchParams.get('lang') === 'en' ? 'en' : 'ar'
  const { refs } = await refLists(ctx.user)
  const buf = await toBuffer(await templateWorkbook(ctx.d, refs, lang))
  return fileResponse(buf, `TechNova-${ctx.d.key}-template.xlsx`)
}
