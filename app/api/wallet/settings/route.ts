/**
 * GET/PUT /api/wallet/settings — Paymob fee (on top), withdrawal fees per payout
 * method, low-balance alert days, top-up offers (phase B). Permission finance_settings.
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import type { Role } from '@prisma/client'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession, requirePermission } from '@/lib/academic/api-helpers'
import { getWalletSettings, saveWalletSettings } from '@/lib/wallet/engine'

export async function GET() {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const role = session.user.role as Role
  const denied = requirePermission(role, 'finance_settings', 'read')
  if (denied) return denied
  return successResponse(await getWalletSettings())
}

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional()
const schema = z.object({
  paymobFeePercent: z.number().min(0).max(20),
  paymobFeeFixed: z.number().min(0).max(1000),
  withdrawFees: z.record(z.string().min(1).max(50), z.object({ type: z.enum(['FIXED', 'PERCENT']), value: z.number().min(0).max(100000) })),
  lowBalanceDays: z.number().int().min(0).max(30),
  promos: z.array(z.object({ id: z.string().optional(), minAmount: z.number().positive(), bonus: z.number().positive(), from: DATE, to: DATE, active: z.boolean() })).max(20),
})

export async function PUT(request: NextRequest) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const denied = requirePermission(session.user.role as Role, 'finance_settings', 'update')
  if (denied) return denied
  let body: unknown
  try { body = await request.json() } catch { return errors.badRequest('Invalid JSON') }
  const parsed = schema.safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)
  const d = parsed.data
  const v = {
    paymobFeePercent: d.paymobFeePercent ?? 0,
    paymobFeeFixed: d.paymobFeeFixed ?? 0,
    withdrawFees: Object.fromEntries(Object.entries(d.withdrawFees ?? {}).map(([k, f]) => [k, { type: f.type === 'PERCENT' ? ('PERCENT' as const) : ('FIXED' as const), value: f.value ?? 0 }])),
    lowBalanceDays: d.lowBalanceDays ?? 3,
    promos: (d.promos ?? []).map((p) => ({ id: p.id || randomUUID(), minAmount: p.minAmount ?? 0, bonus: p.bonus ?? 0, from: p.from ?? null, to: p.to ?? null, active: !!p.active })),
  }
  await saveWalletSettings(v, session.user.id)
  return successResponse(v, 'Saved')
}
