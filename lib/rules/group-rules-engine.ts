/**
 * Rules & policies (2026-10-16) — database side of group rules: the full list for a group (automatic + written on four
 * levels), the parent's acceptance (mandatory; the portal is blocked until accepted), the staff view, written-rule CRUD.
 * Server-only. Pure sentences in ./group-rules.ts.
 */

import { createHash } from 'crypto'
import { prisma } from '@/lib/prisma'
import { isModuleOn } from '@/lib/platform/settings'
import { cyclePrice } from '@/lib/pricing/group-price'
import { sessionsPerCycle } from '@/lib/groups/cycle-rules'
import { groupContext } from '@/lib/discounts/engine'
import { resolveRefundRule } from '@/lib/refunds/engine'
import { excuseSettingsFor } from '@/lib/excuses/engine'
import { buildGroupRules, rulesFingerprintText, type RuleItem } from './group-rules'

export const RULE_SCOPES = ['GLOBAL', 'CAMPUS', 'LEVEL', 'GROUP'] as const
export type RuleScope = (typeof RULE_SCOPES)[number]

const hash = (items: RuleItem[]) => createHash('sha256').update(rulesFingerprintText(items)).digest('hex')

/** The rules of a group right now, and their fingerprint. */
export async function rulesForGroup(classSectionId: string): Promise<{ items: RuleItem[]; hash: string } | null> {
  const g = await prisma.classSection.findUnique({
    where: { id: classSectionId },
    select: {
      id: true, campusId: true, levelId: true, requireFullPaymentToStart: true, partialPaymentCounts: true, installmentsAllowed: true,
      maxStudents: true, scheduleSlots: true, unnamedHeadcount: true, priceOverride: true,
      level: { select: { id: true, pricingType: true, monthlyPrice: true, fullLevelPrice: true, numberOfSessions: true, numberOfMonths: true } },
    },
  })
  if (!g) return null
  const [price, refund, excuse, written] = await Promise.all([
    g.level ? cyclePrice(g.level, g.campusId, g.priceOverride) : Promise.resolve(null),
    resolveRefundRule(prisma, await groupContext(prisma, classSectionId)),
    excuseSettingsFor(classSectionId),
    prisma.groupRule.findMany({
      where: {
        isActive: true,
        OR: [
          { scope: 'GLOBAL' },
          { scope: 'CAMPUS', scopeId: g.campusId },
          ...(g.levelId ? [{ scope: 'LEVEL', scopeId: g.levelId }] : []),
          { scope: 'GROUP', scopeId: g.id },
        ],
      },
      select: { scope: true, textEn: true, textAr: true, sortOrder: true },
    }),
  ])
  const items = buildGroupRules({
    group: { ...g, scheduleSlots: Array.isArray(g.scheduleSlots) ? (g.scheduleSlots as { dayOfWeek: number; time: string }[]) : null },
    price,
    pricingType: (g.level?.pricingType as 'MONTHLY' | 'FULL_LEVEL' | undefined) ?? null,
    sessionsPerCycle: g.level ? sessionsPerCycle(g.level) : null,
    refund,
    excuse,
    written: written.map((w) => ({ ...w, scope: w.scope as RuleScope })),
  })
  return { items, hash: hash(items) }
}

/** The children of a portal parent (Parent or Guardian profile). */
async function childrenOf(userId: string) {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { guardian: { select: { students: { select: { id: true, firstName: true, lastName: true } } } }, parent: { select: { students: { select: { id: true, firstName: true, lastName: true } } } } },
  })
  const all = [...(u?.guardian?.students ?? []), ...(u?.parent?.students ?? [])]
  return [...new Map(all.map((s) => [s.id, s])).values()]
}

/** Group rules this parent still has to accept (one entry per child + group). Empty when the agreements module is off. */
export async function pendingGroupRules(user: { id: string; role: string }) {
  if (user.role !== 'PARENT' && user.role !== 'GUARDIAN') return []
  if (!(await isModuleOn('agreements'))) return []
  const kids = await childrenOf(user.id)
  if (!kids.length) return []
  const enrollments = await prisma.studentEnrollment.findMany({
    where: { studentId: { in: kids.map((k) => k.id) }, status: 'ACTIVE', classSection: { status: 'ACTIVE', isActive: true } },
    select: { studentId: true, classSection: { select: { id: true, className: true, sectionName: true, campus: { select: { name: true } }, level: { select: { name: true, subject: { select: { name: true } } } } } } },
  })
  const accepted = await prisma.groupRulesAcceptance.findMany({ where: { userId: user.id, classSectionId: { in: enrollments.map((e) => e.classSection.id) } }, select: { classSectionId: true, studentId: true, rulesHash: true } })
  const out = []
  for (const e of enrollments) {
    const r = await rulesForGroup(e.classSection.id)
    if (!r) continue
    if (accepted.some((a) => a.classSectionId === e.classSection.id && a.studentId === e.studentId && a.rulesHash === r.hash)) continue
    const kid = kids.find((k) => k.id === e.studentId)!
    const g = e.classSection
    out.push({
      groupId: g.id, studentId: kid.id, student: `${kid.firstName} ${kid.lastName}`.trim(),
      group: `${g.className} ${g.sectionName}`.trim(), place: g.campus?.name ?? '', level: g.level ? `${g.level.subject?.name ?? ''} › ${g.level.name}` : '',
      updated: accepted.some((a) => a.classSectionId === g.id && a.studentId === kid.id),
      items: r.items, hash: r.hash,
    })
  }
  return out
}

export async function acceptGroupRules(input: { userId: string; role: string; groupId: string; studentId: string; hash: string; ip?: string | null; userAgent?: string | null }) {
  if (input.role !== 'PARENT' && input.role !== 'GUARDIAN') return { ok: false, message: 'Only parents accept group rules' }
  const kids = await childrenOf(input.userId)
  if (!kids.some((k) => k.id === input.studentId)) return { ok: false, message: 'This is not your child' }
  if (!(await prisma.studentEnrollment.count({ where: { studentId: input.studentId, classSectionId: input.groupId, status: 'ACTIVE' } }))) return { ok: false, message: 'Your child is not in this group' }
  const r = await rulesForGroup(input.groupId)
  if (!r || r.hash !== input.hash) return { ok: false, message: 'The rules were just updated — please read them again' }
  await prisma.groupRulesAcceptance.upsert({
    where: { classSectionId_studentId_userId_rulesHash: { classSectionId: input.groupId, studentId: input.studentId, userId: input.userId, rulesHash: r.hash } },
    create: { classSectionId: input.groupId, studentId: input.studentId, userId: input.userId, rulesHash: r.hash, ip: input.ip?.slice(0, 64) ?? null, userAgent: input.userAgent?.slice(0, 300) ?? null },
    update: {},
  })
  return { ok: true }
}

/** Staff: the rules of a group and which families accepted the current rules. */
export async function groupRulesStatus(groupId: string) {
  const r = await rulesForGroup(groupId)
  if (!r) return null
  const enrollments = await prisma.studentEnrollment.findMany({
    where: { classSectionId: groupId, status: 'ACTIVE' },
    select: { student: { select: { id: true, firstName: true, lastName: true, guardians: { select: { userId: true, firstName: true, lastName: true, phoneNumber: true } } } } },
  })
  const acc = await prisma.groupRulesAcceptance.findMany({ where: { classSectionId: groupId, rulesHash: r.hash }, select: { studentId: true, userId: true, acceptedAt: true } })
  return {
    items: r.items,
    hash: r.hash,
    families: enrollments.map((e) => {
      const a = acc.find((x) => x.studentId === e.student.id)
      const g = e.student.guardians.find((x) => x.userId === a?.userId) ?? e.student.guardians[0]
      return { studentId: e.student.id, student: `${e.student.firstName} ${e.student.lastName}`.trim(), parent: g ? `${g.firstName} ${g.lastName}`.trim() : null, phone: g?.phoneNumber ?? null, acceptedAt: a?.acceptedAt ?? null }
    }),
  }
}

// ── written rules ─────────────────────────────────────────────────────────────

export async function listWrittenRules(scope?: RuleScope, scopeId?: string | null) {
  return prisma.groupRule.findMany({ where: { ...(scope && { scope }), ...(scope && scope !== 'GLOBAL' && scopeId ? { scopeId } : {}) }, orderBy: [{ scope: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }] })
}

export async function saveWrittenRule(userId: string, id: string | null, input: { scope: RuleScope; scopeId?: string | null; textEn: string; textAr: string; sortOrder?: number; isActive?: boolean }) {
  const data = {
    scope: input.scope, scopeId: input.scope === 'GLOBAL' ? null : input.scopeId ?? null, textEn: input.textEn.trim(), textAr: input.textAr.trim(),
    sortOrder: input.sortOrder ?? 0, ...(input.isActive !== undefined && { isActive: input.isActive }), updatedById: userId,
  }
  return id ? prisma.groupRule.update({ where: { id }, data }) : prisma.groupRule.create({ data })
}
