/**
 * Batch is switched off for TechNova (owner, 2026-10-03): it does not exist in
 * the UI any more. The database still needs a batch on every student and group
 * (old template columns, kept so no data is lost), so the system quietly uses
 * one default batch per branch: "General" (created the first time if missing).
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

type Db = Prisma.TransactionClient | typeof prisma
export const DEFAULT_BATCH_NAME = 'General'

export async function defaultBatchId(campusId: string, db: Db = prisma): Promise<string> {
  const existing =
    (await db.batch.findFirst({ where: { campusId, name: DEFAULT_BATCH_NAME }, select: { id: true } })) ??
    (await db.batch.findFirst({ where: { campusId, isActive: true }, orderBy: { createdAt: 'asc' }, select: { id: true } }))
  if (existing) return existing.id
  try {
    const created = await db.batch.create({
      data: { name: DEFAULT_BATCH_NAME, code: 'GEN', campusId, academicLevel: 'All', description: 'Default (batches are not used)' },
      select: { id: true },
    })
    return created.id
  } catch {
    // created at the same moment by another request (unique name per branch)
    const again = await db.batch.findFirst({ where: { campusId, name: DEFAULT_BATCH_NAME }, select: { id: true } })
    if (again) return again.id
    throw new Error('Could not prepare the default batch')
  }
}

/** The batch sent (old screens / imports), or the branch's default one. */
export async function resolveBatchId(campusId: string, batchId?: string | null, db: Db = prisma): Promise<string> {
  if (batchId) {
    const ok = await db.batch.findFirst({ where: { id: batchId, campusId }, select: { id: true } })
    if (ok) return ok.id
  }
  return defaultBatchId(campusId, db)
}
