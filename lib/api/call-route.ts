/** Call one of our own API handlers with the signed-in person's session (same cookies) and read its JSON. So every rule of that route applies. */

import { NextRequest } from 'next/server'

export type RouteResult = { ok: boolean; status: number; data: Record<string, unknown> | null; message: string; code: string | null }

export async function callRoute(
  handler: (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>,
  origin: string, cookie: string, path: string, method: string, body: unknown, params: Record<string, string> = {},
): Promise<RouteResult> {
  const req = new NextRequest(new URL(path, origin), { method, headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) })
  const res = await handler(req, { params: Promise.resolve(params) })
  const json = (await res.json().catch(() => null)) as { success?: boolean; data?: Record<string, unknown>; error?: { code?: string; message?: string; details?: unknown }; message?: string } | null
  // validation errors come as [{ field, message }] (lib/api-response.ts)
  const detail = json?.error?.details as { field?: string; message?: string }[] | undefined
  const fieldMsg = Array.isArray(detail) && detail.length ? detail.map((e) => `${e.field ? `${e.field}: ` : ''}${e.message ?? ''}`).join('; ') : ''
  return { ok: res.ok && json?.success !== false, status: res.status, data: json?.data ?? null, message: fieldMsg || json?.error?.message || json?.message || `HTTP ${res.status}`, code: json?.error?.code ?? null }
}
