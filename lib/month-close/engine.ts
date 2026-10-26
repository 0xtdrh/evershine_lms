/**
 * a03 month close — close / reopen a month (company or one branch), the checklist of things still waiting, the
 * automatic close (daily job), the list of months for the screen and "your work today". The guard that refuses
 * writes is lib/month-close/guard.ts; pure rules lib/month-close/rules.ts. Server-only.
 *
 * Who: month_close:create closes (Admin / Accountant by default), month_close:approve reopens (Super Admin).
 * A company-wide close needs every place; a branch close needs that branch.
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { checkPermission } from '@/lib/rbac'
import { getSetting, setSetting } from '@/lib/settings/app-settings'
import { allowsCampus, loadPlaces } from '@/lib/places/server'
import { notifyUsers, usersWithPermission } from '@/lib/notifications/events'
import { forgetLocks } from './guard'
import { monthReport, type MonthReport } from './report'
import {
  ALL_SCOPE, addMonths, autoLockDue, canLockYm, cleanSettings, currentYm, DEFAULT_MONTH_CLOSE_SETTINGS, monthName, monthRange,
  pendingTotal, YM, type MonthCloseSettings, type Pending,
} from './rules'

type Who = { id: string; role: string }
export class MonthCloseError extends Error { constructor(message: string, readonly status = 400) { super(message) } }

const KEY = 'monthClose.settings'
export const getMonthCloseSettings = () => getSetting<MonthCloseSettings>(KEY, DEFAULT_MONTH_CLOSE_SETTINGS)
export async function saveMonthCloseSettings(v: Partial<MonthCloseSettings>, userId: string) {
  const next = cleanSettings(v, await getMonthCloseSettings())
  await setSetting(KEY, next, userId)
  return next
}

const scopeKeyOf = (campusId: string | null) => campusId ?? ALL_SCOPE

/** May this person act on this scope? (company = every place) */
async function ownsScope(user: Who, campusId: string | null) {
  const p = await loadPlaces(user)
  return campusId ? allowsCampus(p, campusId) : p.all
}

export const canReadMonthClose = (role: string) => checkPermission(role, 'month_close', 'read') || checkPermission(role, 'financial_reports', 'read')

// ── checklist ────────────────────────────────────────────────────────────────

/** Things dated in the month that still wait for someone (closing would freeze them as they are). */
export async function pendingFor(ym: string, campusId: string | null): Promise<Pending> {
  const { from, to } = monthRange(ym)
  const inMonth = { gte: from, lt: to }
  const students = campusId ? { studentId: { in: (await prisma.student.findMany({ where: { campusId }, select: { id: true } })).map((s) => s.id).concat('__none__') } } : {}
  const invoicePlace = campusId ? { OR: [{ classSection: { campusId } }, { classSectionId: null, student: { campusId } }] } : {}
  const accIds = campusId ? (await prisma.moneyAccount.findMany({ where: { campusId }, select: { id: true } })).map((a) => a.id).concat('__none__') : null
  const [proofs, refunds, topUps, withdrawals, expenses, transfers, counts, slips, notPlaced] = await Promise.all([
    prisma.feeInvoice.count({ where: { proofStatus: 'PENDING', proofUploadedAt: inMonth, ...invoicePlace } }),
    prisma.refund.count({ where: { status: 'PENDING', createdAt: inMonth, ...students } }),
    prisma.walletTopUp.count({ where: { status: 'PENDING', createdAt: inMonth, ...students } }),
    prisma.walletWithdrawal.count({ where: { status: 'PENDING', createdAt: inMonth, ...students } }),
    prisma.expense.count({ where: { isDeleted: false, isApproved: false, date: inMonth, ...(campusId ? { campusId } : {}) } }),
    prisma.moneyTransfer.count({ where: { status: 'PENDING', date: inMonth, ...(accIds ? { OR: [{ fromAccountId: { in: accIds } }, { toAccountId: { in: accIds } }] } : {}) } }),
    prisma.cashCount.count({ where: { status: 'PENDING', date: inMonth, ...(accIds ? { accountId: { in: accIds } } : {}) } }),
    campusId ? Promise.resolve(0) : prisma.salarySlip.count({ where: { isDeleted: false, approvalStatus: 'PENDING', status: { not: 'CANCELLED' }, salaryPeriodStart: inMonth } }),
    prisma.moneyMovement.count({ where: { accountId: null, date: inMonth, ...(campusId ? { campusId } : {}) } }),
  ])
  const out: Pending = { proofs, refunds, topUps, withdrawals, expenses, transfers, counts, slips, notPlaced }
  for (const k of Object.keys(out) as (keyof Pending)[]) if (!out[k]) delete out[k]
  return out
}

// ── close / reopen ───────────────────────────────────────────────────────────

async function tellFinance(campusId: string | null, title: string, message: string, titleAr: string, messageAr: string, relatedId: string) {
  try {
    const ids = await usersWithPermission('month_close', 'read', campusId)
    await notifyUsers(ids, 'MONTH_CLOSE', { title, message, titleAr, messageAr, relatedId })
  } catch (err) { console.error('[MONTH_CLOSE_NOTIFY]', err) }
}

export async function lockMonth(user: Who | null, ym: string, campusId: string | null, opts: { auto?: boolean } = {}) {
  if (!YM.test(ym)) throw new MonthCloseError('Month must be YYYY-MM · الشهر لازم يبقى YYYY-MM')
  if (!canLockYm(ym)) throw new MonthCloseError('Only a month that is over can be closed · ينفع تقفل شهر خلص بس')
  if (user) {
    if (!checkPermission(user.role, 'month_close', 'create')) throw new MonthCloseError('You may not close months · مش من صلاحيتك تقفل الشهر', 403)
    if (!(await ownsScope(user, campusId))) throw new MonthCloseError(campusId ? 'This branch is not yours · الفرع ده مش بتاعك' : 'Closing the whole company needs access to every branch · قفل الشركة كلها محتاج صلاحية على كل الفروع', 403)
  }
  if (campusId && !(await prisma.campus.findUnique({ where: { id: campusId }, select: { id: true } }))) throw new MonthCloseError('Branch not found', 404)
  const scopeKey = scopeKeyOf(campusId)
  const existing = await prisma.monthLock.findUnique({ where: { ym_scopeKey: { ym, scopeKey } } })
  if (existing?.status === 'LOCKED') throw new MonthCloseError('This month is already closed · الشهر ده مقفول بالفعل', 409)

  const snapshot = (await monthReport(ym, campusId)) as unknown as Prisma.InputJsonValue
  const data = { status: 'LOCKED', auto: !!opts.auto, lockedAt: new Date(), lockedById: user?.id ?? null, reopenedAt: null, reopenedById: null, reopenReason: null, snapshot, campusId }
  const row = existing
    ? await prisma.monthLock.update({ where: { id: existing.id }, data })
    : await prisma.monthLock.create({ data: { ym, scopeKey, ...data } })
  await prisma.monthLockEvent.create({ data: { ym, scopeKey, action: opts.auto ? 'AUTO_LOCK' : 'LOCK', byId: user?.id ?? null } })
  forgetLocks()
  const place = campusId ? (await prisma.campus.findUnique({ where: { id: campusId }, select: { name: true } }))?.name ?? '' : ''
  await tellFinance(campusId,
    `${monthName(ym, 'en')} closed${place ? ` — ${place}` : ''}`, opts.auto ? 'Closed automatically. Its monthly report is saved.' : 'Its monthly report is saved.',
    `اتقفل شهر ${monthName(ym, 'ar')}${place ? ` — ${place}` : ''}`, opts.auto ? 'اتقفل تلقائياً، والتقرير الشهري بتاعه اتحفظ.' : 'التقرير الشهري بتاعه اتحفظ.', row.id)
  return row
}

export async function reopenMonth(user: Who, ym: string, campusId: string | null, reason: string) {
  if (!checkPermission(user.role, 'month_close', 'approve')) throw new MonthCloseError('Only a Super Admin can reopen a month · الـ Super Admin بس يقدر يفتح الشهر', 403)
  if (!reason || reason.trim().length < 5) throw new MonthCloseError('Write why the month is reopened · اكتب سبب فتح الشهر')
  if (!(await ownsScope(user, campusId))) throw new MonthCloseError('This branch is not yours · الفرع ده مش بتاعك', 403)
  const scopeKey = scopeKeyOf(campusId)
  const row = await prisma.monthLock.findUnique({ where: { ym_scopeKey: { ym, scopeKey } } })
  if (!row || row.status !== 'LOCKED') throw new MonthCloseError('This month is not closed · الشهر ده مش مقفول', 409)
  const out = await prisma.monthLock.update({ where: { id: row.id }, data: { status: 'OPEN', reopenedAt: new Date(), reopenedById: user.id, reopenReason: reason.trim() } })
  await prisma.monthLockEvent.create({ data: { ym, scopeKey, action: 'REOPEN', reason: reason.trim(), byId: user.id } })
  forgetLocks()
  await tellFinance(campusId, `${monthName(ym, 'en')} reopened`, reason.trim(), `اتفتح شهر ${monthName(ym, 'ar')} تاني`, reason.trim(), row.id)
  return out
}

/** Daily job: close last month company-wide on the set day, when nothing is waiting. */
export async function autoCloseLastMonth(now: Date = new Date()): Promise<{ closed: string | null; pending: number }> {
  const settings = await getMonthCloseSettings()
  if (!settings.autoLock) return { closed: null, pending: 0 }
  const ym = addMonths(currentYm(now), -1)
  const row = await prisma.monthLock.findUnique({ where: { ym_scopeKey: { ym, scopeKey: ALL_SCOPE } }, select: { status: true } })
  if (row) return { closed: null, pending: 0 }
  const pending = await pendingFor(ym, null)
  if (!autoLockDue({ settings, now, lastMonthRow: row, pending })) return { closed: null, pending: pendingTotal(pending) }
  await lockMonth(null, ym, null, { auto: true })
  return { closed: ym, pending: 0 }
}

// ── screen data ──────────────────────────────────────────────────────────────

export interface MonthRow {
  ym: string
  scopeKey: string
  campusId: string | null
  placeName: string
  status: 'LOCKED' | 'OPEN' | 'NONE'
  /** closed for this branch because the whole company is closed */
  byCompany: boolean
  auto: boolean
  lockedAt: string | null
  lockedBy: string | null
  reopenedAt: string | null
  reopenReason: string | null
}

/** The last N finished months × the scopes this person may see (company first, when they have every place). */
export async function listMonths(user: Who, months = 12): Promise<{ scopes: { campusId: string | null; name: string }[]; rows: MonthRow[] }> {
  const p = await loadPlaces(user)
  const campuses = await prisma.campus.findMany({ where: { isActive: true, ...(p.all ? {} : { id: { in: p.campusIds.length ? p.campusIds : ['__none__'] } }) }, select: { id: true, name: true }, orderBy: { name: 'asc' } })
  const scopes = [...(p.all ? [{ campusId: null, name: 'ALL' }] : []), ...campuses.map((c) => ({ campusId: c.id as string | null, name: c.name }))]
  const now = currentYm()
  const yms = Array.from({ length: Math.min(36, Math.max(1, months)) }, (_, i) => addMonths(now, -(i + 1)))
  const locks = await prisma.monthLock.findMany({ where: { ym: { in: yms } } })
  const names = new Map((await prisma.user.findMany({ where: { id: { in: locks.map((l) => l.lockedById).filter((x): x is string => !!x) } }, select: { id: true, displayName: true, email: true } })).map((u) => [u.id, u.displayName || u.email]))
  const rows: MonthRow[] = []
  for (const ym of yms) {
    const company = locks.find((l) => l.ym === ym && l.scopeKey === ALL_SCOPE)
    for (const s of scopes) {
      const key = scopeKeyOf(s.campusId)
      const own = locks.find((l) => l.ym === ym && l.scopeKey === key)
      const byCompany = !!s.campusId && company?.status === 'LOCKED' && own?.status !== 'LOCKED'
      const l = byCompany ? company! : own
      rows.push({
        ym, scopeKey: key, campusId: s.campusId, placeName: s.name,
        status: byCompany ? 'LOCKED' : (own?.status as 'LOCKED' | 'OPEN' | undefined) ?? 'NONE', byCompany,
        auto: !!l?.auto, lockedAt: l?.lockedAt?.toISOString() ?? null, lockedBy: l?.lockedById ? names.get(l.lockedById) ?? null : l ? 'TechNova (auto)' : null,
        reopenedAt: own?.reopenedAt?.toISOString() ?? null, reopenReason: own?.reopenReason ?? null,
      })
    }
  }
  return { scopes, rows }
}

export async function monthHistory(ym: string) {
  const events = await prisma.monthLockEvent.findMany({ where: { ym }, orderBy: { createdAt: 'desc' }, take: 50 })
  const names = new Map((await prisma.user.findMany({ where: { id: { in: events.map((e) => e.byId).filter((x): x is string => !!x) } }, select: { id: true, displayName: true, email: true } })).map((u) => [u.id, u.displayName || u.email]))
  return events.map((e) => ({ ...e, by: e.byId ? names.get(e.byId) ?? null : null }))
}

/** The report: frozen copy when the month is closed for that scope (unless `live`), else computed now. */
export async function reportFor(user: Who, ym: string, campusId: string | null, live = false): Promise<{ report: MonthReport; frozen: boolean; lockedAt: string | null }> {
  if (!YM.test(ym)) throw new MonthCloseError('Month must be YYYY-MM · الشهر لازم يبقى YYYY-MM')
  if (!canReadMonthClose(user.role)) throw new MonthCloseError('Not allowed', 403)
  if (!(await ownsScope(user, campusId))) throw new MonthCloseError(campusId ? 'This branch is not yours · الفرع ده مش بتاعك' : 'The company report needs access to every branch · تقرير الشركة محتاج صلاحية على كل الفروع', 403)
  if (!live) {
    const row = await prisma.monthLock.findUnique({ where: { ym_scopeKey: { ym, scopeKey: scopeKeyOf(campusId) } } })
    if (row?.status === 'LOCKED' && row.snapshot) return { report: row.snapshot as unknown as MonthReport, frozen: true, lockedAt: row.lockedAt.toISOString() }
  }
  return { report: await monthReport(ym, campusId), frozen: false, lockedAt: null }
}

/** "Your work today": 1 when last month is still open for this person's scope, from the reminder day on. */
export async function lastMonthOpenCount(user: Who, now: Date = new Date()): Promise<number> {
  if (!checkPermission(user.role, 'month_close', 'create')) return 0
  const s = await getMonthCloseSettings()
  const day = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', day: 'numeric' }).format(now))
  if (day < s.remindDay) return 0
  const ym = addMonths(currentYm(now), -1)
  const p = await loadPlaces(user)
  const locks = await prisma.monthLock.findMany({ where: { ym, status: 'LOCKED' }, select: { scopeKey: true } })
  if (locks.some((l) => l.scopeKey === ALL_SCOPE)) return 0
  if (p.all) return 1
  return p.campusIds.some((c) => !locks.some((l) => l.scopeKey === c)) ? 1 : 0
}
