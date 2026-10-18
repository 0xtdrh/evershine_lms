/**
 * 2026-10-18 "who changed what": every create / update / delete on the important tables is written to AuditLog with
 * the old and new value of each changed field — automatically, from one Prisma query extension, so no route has to
 * remember it. Who = the signed-in person of the request (lib/permission-context.ts); system jobs (no person) are not
 * logged. Secrets (passwords, tokens) are never stored. A logging failure never breaks the change itself.
 * Server-only. Pure helpers (diffRecords, sanitize) are tested in tests/audit-auto.test.ts.
 */

import { Prisma, type PrismaClient } from '@prisma/client'

/** Tables whose changes are kept (Prisma model names). */
export const AUDITED_MODELS = new Set([
  'Student', 'Guardian', 'ClassSection', 'StudentEnrollment', 'FeeInvoice', 'FeePayment', 'Teacher', 'Expense', 'Campus',
  'Level', 'AcademicSubject', 'Track', 'User', 'DiscountAssignment', 'DiscountType', 'Refund', 'SalarySlip', 'MoneyAccount',
  'AccountRoute', 'FeeType', 'FeeRule', 'Holiday', 'PaymentMethod', 'PaymentAccount', 'AppSetting', 'RolePermission',
  'UserPermissionOverride', 'LocationPermissionOverride', 'Partner', 'PartnerDeal', 'CurriculumEdition', 'Agreement',
  'GroupRule', 'WalletTopUp', 'MoneyTransfer', 'CashCount', 'Budget', 'ExpenseCategoryDef',
])

const SECRET = /password|token|secret|otp|hash/i
const SKIP_FIELDS = new Set(['updatedAt', 'createdAt'])
const MAX_VALUE = 500

function plain(v: unknown): unknown {
  if (v === null || v === undefined) return null
  if (v instanceof Date) return v.toISOString()
  if (Prisma.Decimal.isDecimal(v)) return Number(v)
  if (typeof v === 'string') return v.length > MAX_VALUE ? `${v.slice(0, MAX_VALUE)}…` : v
  if (typeof v === 'object') { const s = JSON.stringify(v); return s.length > MAX_VALUE ? `${s.slice(0, MAX_VALUE)}…` : JSON.parse(s) }
  return v
}

/** A record without secrets, long texts cut, dates / decimals as plain values. */
export function sanitize(rec: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!rec) return null
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(rec)) {
    if (SECRET.test(k) || SKIP_FIELDS.has(k) || (v !== null && typeof v === 'object' && !(v instanceof Date) && !Prisma.Decimal.isDecimal(v) && !Array.isArray(v) && 'id' in (v as object))) continue // relations left out
    out[k] = plain(v)
  }
  return out
}

/** Fields that changed: { field: [old, new] } (only fields present in both; secrets left out). */
export function diffRecords(before: Record<string, unknown> | null, after: Record<string, unknown> | null): Record<string, [unknown, unknown]> {
  const b = sanitize(before) ?? {}, a = sanitize(after) ?? {}
  const out: Record<string, [unknown, unknown]> = {}
  for (const k of Object.keys(a)) {
    if (!(k in b)) continue
    if (JSON.stringify(b[k]) !== JSON.stringify(a[k])) out[k] = [b[k], a[k]]
  }
  return out
}

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1)
const WRITE_OPS = new Set(['create', 'update', 'delete', 'upsert', 'createMany', 'updateMany', 'deleteMany'])
type Write = (userId: string, action: string, entityType: string, entityId: string | null, changes: unknown) => void
let writeLog: Write = () => {}

/** One audited write: runs it, then logs who / what / old → new. */
async function audited(userId: string, model: string, operation: string, args: unknown, run: (a: unknown) => Promise<unknown>, findBefore: (where: unknown) => Promise<Record<string, unknown> | null>): Promise<unknown> {
  const a = args as { where?: unknown; data?: Record<string, unknown> }
  if (operation === 'update' || operation === 'delete' || operation === 'upsert') {
    const before = a.where ? await findBefore(a.where).catch(() => null) : null
    const result = (await run(args)) as Record<string, unknown> | null
    const id = (result?.id as string | undefined) ?? (before?.id as string | undefined) ?? null
    if (operation === 'delete') writeLog(userId, 'DELETE', model, id, { auto: true, before: sanitize(before) })
    else if (!before) writeLog(userId, 'CREATE', model, id, { auto: true, after: sanitize(result) })
    else {
      // a write that selects only a few fields: rebuild the new record from the old one + the plain values written
      const written: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(a.data ?? {})) {
        if (v === null || v instanceof Date || Prisma.Decimal.isDecimal(v) || typeof v !== 'object') written[k] = v
      }
      const changed = diffRecords(before, { ...before, ...written, ...(result ?? {}) })
      if (Object.keys(changed).length) writeLog(userId, 'UPDATE', model, id, { auto: true, changed })
    }
    return result
  }
  if (operation === 'create') {
    const result = (await run(args)) as Record<string, unknown> | null
    writeLog(userId, 'CREATE', model, (result?.id as string | undefined) ?? null, { auto: true, after: sanitize(result) })
    return result
  }
  if (operation === 'updateMany' || operation === 'deleteMany' || operation === 'createMany') {
    const result = (await run(args)) as { count?: number }
    if (result?.count) {
      const one = Array.isArray(a.data) ? null : a.data
      const fields = one ? Object.keys(one).filter((k) => !SECRET.test(k)) : []
      const action = operation === 'updateMany' ? 'UPDATE_MANY' : operation === 'deleteMany' ? 'DELETE_MANY' : 'CREATE_MANY'
      writeLog(userId, action, model, null, { auto: true, count: result.count, fields, set: operation === 'updateMany' ? sanitize(one) : null })
    }
    return result
  }
  return run(args)
}

/**
 * Wraps a PrismaClient so changes on AUDITED_MODELS are logged. `whoIsActing` returns the signed-in user id (or null).
 * The base client is used for the "before" read and for the log row, so logging never logs itself.
 * Inside interactive transactions lib/prisma.ts pins the actor read when the transaction began.
 */
export function withAutoAudit(base: PrismaClient, whoIsActing: () => string | null): PrismaClient {
  writeLog = (userId, action, entityType, entityId, changes) => {
    void base.auditLog.create({ data: { userId, action, entityType, entityId, changes: changes as Prisma.InputJsonValue } }).catch((e) => console.error('[AUTO_AUDIT]', e instanceof Error ? e.message : e))
  }
  // the generic $extends typing is too big for TypeScript here; the callback is typed by hand
  const extend = (base as unknown as { $extends: (ext: unknown) => unknown }).$extends
  type Op = { model?: string; operation: string; args: unknown; query: (a: unknown) => Promise<unknown> }
  return extend.call(base, {
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }: Op) {
          if (!model || !AUDITED_MODELS.has(model) || !WRITE_OPS.has(operation)) return query(args)
          const userId = whoIsActing()
          if (!userId) return query(args)
          const delegate = (base as unknown as Record<string, { findUnique: (a: unknown) => Promise<Record<string, unknown> | null> }>)[lowerFirst(model)]
          return audited(userId, model, operation, args, query, (where) => delegate.findUnique({ where }))
        },
      },
    },
  }) as unknown as PrismaClient
}
