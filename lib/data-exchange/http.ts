/** Phase 6: shared bits of the /api/data/* routes — who may do what, the log, file responses. Server-only. */

import { auth } from '@/lib/auth'
import { checkPermission, normalizeRole } from '@/lib/rbac'
import { prisma } from '@/lib/prisma'
import { loadPlaces } from '@/lib/places/server'
import { datasetByKey, exchangeRights, type DatasetDef } from './registry'

export async function exchangeContext(key: string) {
  const session = await auth()
  if (!session?.user) return { error: 401 as const }
  const role = normalizeRole(session.user.role)
  const d = datasetByKey(key)
  if (!role || !d) return { error: 404 as const }
  const rights = exchangeRights(d, (r, a) => checkPermission(role, r, a))
  return { user: { id: session.user.id, role }, d, rights }
}

export async function logExchange(user: { id: string; role: string }, d: DatasetDef, kind: 'IMPORT' | 'EXPORT', data: { format?: string; fileName?: string; rows?: number; created?: number; failed?: number }) {
  try {
    const places = await loadPlaces(user)
    return await prisma.dataExchangeLog.create({
      data: { kind, dataset: d.key, format: data.format ?? null, fileName: data.fileName?.slice(0, 200) ?? null, rows: data.rows ?? 0, created: data.created ?? 0, failed: data.failed ?? 0, userId: user.id, campusId: places.all ? null : places.primary },
    })
  } catch (err) {
    console.error('[DATA_EXCHANGE_LOG]', err)
    return null
  }
}

export function fileResponse(buf: Buffer, fileName: string) {
  return new Response(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${fileName.replace(/[^\w.\-]+/g, '_')}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      'Cache-Control': 'no-store',
    },
  })
}

export const stamp = () => new Date().toISOString().slice(0, 10)
