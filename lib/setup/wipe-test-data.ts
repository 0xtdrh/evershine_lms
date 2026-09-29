/**
 * One-time removal of ALL test data before going live (owner, 2026-09-29:
 * "everything is test, delete everything").
 *
 * KEPT:
 *  - Super Admin accounts (+ their Admin profile, moved to the main branch)
 *  - Main branch "TechNova Company" (code TN) and its batch "General"
 *  - The 5 Nova tracks, their courses and levels (from Initial Setup)
 *  - Configuration: Permissions overrides, academic year, shifts,
 *    certificate designs, feedback questions, result-card settings
 * DELETED: every other row in every other table (students, parents,
 *  teachers, staff accounts, groups, attendance, invoices, payments,
 *  salaries, results, certificates, applications, notifications, audit
 *  logs, template data...). Other branches are deleted too.
 *
 * Safety: Super Admin only, typed confirmation, a backup is taken first (no
 * backup -> nothing is deleted), everything runs in ONE transaction, and every
 * foreign key is verified at the end — any broken reference rolls it all back.
 */

import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
import { TRACKS, MAIN_BRANCH } from './initial-setup'

export const WIPE_CONFIRMATION = 'امسح كل بيانات التجربة'

/** Tables kept completely. */
const KEEP_ALL = new Set(['_prisma_migrations', 'AcademicYear', 'Shift', 'CertificateTemplate', 'FeedbackQuestion', 'ResultCardConfig', 'RolePermission'])

type Tx = Prisma.TransactionClient | typeof prisma

const NOVA_TRACKS = TRACKS.map((t) => `'${t.name}'`).join(',')
const q = (name: string) => '`' + name.replace(/`/g, '``') + '`'

/** WHERE clause selecting the rows to DELETE in a partially kept table. */
function filteredDeletes(mainId: string): Record<string, string> {
  return {
    User: `role <> 'SUPER_ADMIN'`,
    Admin: `userId NOT IN (SELECT id FROM \`User\` WHERE role = 'SUPER_ADMIN')`,
    Campus: `id <> '${mainId}'`,
    Batch: `NOT (name = 'General' AND campusId = '${mainId}')`,
    Track: `name NOT IN (${NOVA_TRACKS})`,
    AcademicSubject: `code NOT LIKE 'NOVA-%'`,
    Level: `subjectId NOT IN (SELECT id FROM \`AcademicSubject\` WHERE code LIKE 'NOVA-%')`,
  }
}

async function listTables(db: Tx): Promise<string[]> {
  const rows = await db.$queryRawUnsafe<{ t: string }[]>(
    "SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'"
  )
  return rows.map((r) => r.t).sort()
}

async function mainBranchId(db: Tx) {
  const main = await db.campus.findFirst({ where: { code: MAIN_BRANCH.code } })
  return main?.id ?? null
}

export interface WipePreviewRow { table: string; toDelete: number; kept: number }

export async function previewWipe(): Promise<{ ready: boolean; reason?: string; rows: WipePreviewRow[]; totalToDelete: number }> {
  const mainId = await mainBranchId(prisma)
  if (!mainId) return { ready: false, reason: 'Run Initial Setup first (the main branch "TechNova Company" must exist).', rows: [], totalToDelete: 0 }
  const filtered = filteredDeletes(mainId)
  const rows: WipePreviewRow[] = []
  for (const table of await listTables(prisma)) {
    const [{ n: total }] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT COUNT(*) AS n FROM ${q(table)}`)
    let toDelete = 0
    if (KEEP_ALL.has(table)) toDelete = 0
    else if (filtered[table]) {
      const [{ n }] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT COUNT(*) AS n FROM ${q(table)} WHERE ${filtered[table]}`)
      toDelete = Number(n)
    } else toDelete = Number(total)
    rows.push({ table, toDelete, kept: Number(total) - toDelete })
  }
  return { ready: true, rows, totalToDelete: rows.reduce((s, r) => s + r.toDelete, 0) }
}

/** Every foreign key in the database, checked for references to missing rows. */
async function findBrokenReferences(db: Tx): Promise<string[]> {
  const fks = await db.$queryRawUnsafe<{ t: string; c: string; rt: string; rc: string }[]>(
    `SELECT TABLE_NAME AS t, COLUMN_NAME AS c, REFERENCED_TABLE_NAME AS rt, REFERENCED_COLUMN_NAME AS rc
       FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL`
  )
  const broken: string[] = []
  for (const fk of fks) {
    const [{ n }] = await db.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT COUNT(*) AS n FROM ${q(fk.t)} x WHERE x.${q(fk.c)} IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM ${q(fk.rt)} r WHERE r.${q(fk.rc)} = x.${q(fk.c)})`
    )
    if (Number(n) > 0) broken.push(`${fk.t}.${fk.c} -> ${fk.rt} (${n})`)
  }
  return broken
}

export async function wipeTestData(actingUserId: string): Promise<{ deleted: Record<string, number> }> {
  return prisma.$transaction(
    async (tx) => {
      const mainId = await mainBranchId(tx)
      if (!mainId) throw new Error('Run Initial Setup first.')
      const filtered = filteredDeletes(mainId)
      const deleted: Record<string, number> = {}

      await tx.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 0')
      try {
        for (const table of await listTables(tx)) {
          if (KEEP_ALL.has(table)) continue
          const where = filtered[table] ? ` WHERE ${filtered[table]}` : ''
          deleted[table] = await tx.$executeRawUnsafe(`DELETE FROM ${q(table)}${where}`)
        }
        // Kept rows must only point at kept rows.
        await tx.$executeRawUnsafe(`UPDATE \`Admin\` SET campusId = ? WHERE campusId <> ?`, mainId, mainId)
        await tx.$executeRawUnsafe(
          `UPDATE \`RolePermission\` SET createdById = ? WHERE createdById NOT IN (SELECT id FROM \`User\`)`,
          actingUserId
        )
      } finally {
        await tx.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 1')
      }

      const broken = await findBrokenReferences(tx)
      if (broken.length) {
        // Throwing rolls back the whole transaction: nothing is deleted.
        throw new Error(`Cleanup cancelled, broken references found: ${broken.slice(0, 5).join('; ')}`)
      }
      return { deleted: Object.fromEntries(Object.entries(deleted).filter(([, n]) => n > 0)) }
    },
    { timeout: 50_000, maxWait: 10_000 }
  )
}
