/**
 * a02 M3 batch 3 (2026-11-02, owner): moving students between groups can be closed: everywhere, for a system (One-to-One, normal
 * groups, online, in a branch), for a place or for a partner. Closed when EITHER side of the move matches.
 * Setting `transfers.settings`. Pure part + reading the setting; tests/one-to-one.test.ts.
 */

import { prisma } from '@/lib/prisma'
import { getSetting, setSetting } from '@/lib/settings/app-settings'
import { groupIsOnline } from '@/lib/teachers/online-pay'

export interface TransferLocks {
  all: boolean
  /** ONE_TO_ONE | GROUP */
  kinds: string[]
  /** ONLINE | BRANCH */
  modes: string[]
  campusIds: string[]
  partnerIds: string[]
}
export const DEFAULT_TRANSFER_LOCKS: TransferLocks = { all: false, kinds: [], modes: [], campusIds: [], partnerIds: [] }
export interface LockSide { kind: string; mode: string; campusId: string; partnerId: string | null }

const KEY = 'transfers.settings'
const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
export function cleanLocks(v: Partial<TransferLocks> | null | undefined): TransferLocks {
  return { all: !!v?.all, kinds: strings(v?.kinds), modes: strings(v?.modes), campusIds: strings(v?.campusIds), partnerIds: strings(v?.partnerIds) }
}

/** Why this move is closed, or null. */
export function transferLockReason(l: TransferLocks, from: LockSide, to: LockSide): string | null {
  if (l.all) return 'Moving students between groups is closed · نقل الطلاب بين الجروبات مقفول'
  for (const s of [from, to]) {
    if (l.kinds.includes(s.kind)) return s.kind === 'ONE_TO_ONE' ? 'Moving to or from a One-to-One is closed · النقل من وإلى One-to-One مقفول' : 'Moving between normal groups is closed · النقل بين الجروبات العادية مقفول'
    if (l.modes.includes(s.mode)) return s.mode === 'ONLINE' ? 'Moving to or from an online group is closed · النقل من وإلى الجروبات الأونلاين مقفول' : 'Moving to or from a branch group is closed · النقل من وإلى جروبات الفرع مقفول'
    if (l.campusIds.includes(s.campusId)) return 'Moving students in this place is closed · نقل الطلاب في المكان ده مقفول'
    if (s.partnerId && l.partnerIds.includes(s.partnerId)) return 'Moving students at this partner is closed · نقل الطلاب عند الشريك ده مقفول'
  }
  return null
}

export const getTransferLocks = async () => cleanLocks(await getSetting<Partial<TransferLocks>>(KEY, DEFAULT_TRANSFER_LOCKS))
export async function saveTransferLocks(v: Partial<TransferLocks>, userId: string) {
  const next = cleanLocks(v)
  await setSetting(KEY, next, userId)
  return next
}

async function side(groupId: string): Promise<LockSide | null> {
  const g = await prisma.classSection.findUnique({ where: { id: groupId }, select: { kind: true, campusId: true, scheduleSlots: true, campus: { select: { kind: true, partnerId: true } } } })
  return g ? { kind: g.kind, mode: groupIsOnline(g.campus?.kind, g.scheduleSlots) ? 'ONLINE' : 'BRANCH', campusId: g.campusId, partnerId: g.campus?.partnerId ?? null } : null
}

/** The reason this move is closed by the setting, or null. */
export async function transferClosed(fromId: string, toId: string): Promise<string | null> {
  const l = await getTransferLocks()
  if (!l.all && !l.kinds.length && !l.modes.length && !l.campusIds.length && !l.partnerIds.length) return null
  const [a, b] = await Promise.all([side(fromId), side(toId)])
  return a && b ? transferLockReason(l, a, b) : null
}
