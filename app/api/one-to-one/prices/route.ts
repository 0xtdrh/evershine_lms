/** a02 M3: One-to-One price list. GET ?levelId= — POST { levelId, campusId?, plan, sessions?, price, siblingPrice?, minutes? } (update = same level + place + plan + sessions). */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { createdResponse, errors, successResponse } from '@/lib/api-response'
import { listPrices, savePrice, type PriceInput } from '@/lib/one-to-one/engine'
import { oneToOneError, oneToOneUser } from '@/lib/one-to-one/http'
import { PLANS } from '@/lib/one-to-one/rules'

export const dynamic = 'force-dynamic'

const schema = z.object({
  levelId: z.string().min(1), campusId: z.string().min(1).nullish(), plan: z.enum(PLANS), sessions: z.number().int().min(1).max(200).nullish(),
  price: z.number().min(0).max(10_000_000), siblingPrice: z.number().min(0).max(10_000_000).nullish(), minutes: z.number().int().min(10).max(300).nullish(),
})

export async function GET(request: NextRequest) {
  const u = await oneToOneUser('read')
  if ('error' in u) return u.error
  return successResponse(await listPrices(request.nextUrl.searchParams.get('levelId')))
}

export async function POST(request: NextRequest) {
  const u = await oneToOneUser('update')
  if ('error' in u) return u.error
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  try { return createdResponse(await savePrice(u.user, parsed.data as PriceInput)) } catch (e) { return oneToOneError(e) }
}
