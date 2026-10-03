/**
 * Money maths for moving a student to another group (pure, unit-tested).
 * Design: docs/design-student-transfer.md.
 *
 * The student owes the old group only what the counted sessions cost
 * (sessions x price per session). Whatever was paid above that is credit
 * (returned as an approved refund to the wallet, then optionally paid onto
 * the new invoice). If less was paid, the old invoice is cut down so only
 * the counted sessions stay due; the rest of it is cancelled.
 */

const round2 = (n: number) => Math.round(n * 100) / 100

export interface TransferMoneyInput {
  /** Old invoice (after discounts) */
  totalAmount: number
  paidAmount: number
  refundedAmount: number
  /** Sessions in the billing cycle of the old group (null = unknown) */
  sessionsInCycle: number | null
  /** Sessions counted against the student (attended, or held — refund rule) */
  sessionsCounted: number
}

export interface TransferMoney {
  perSession: number
  sessionsCounted: number
  /** What the counted sessions cost */
  consumed: number
  netPaid: number
  /** Paid but not used: goes to the wallet / the new invoice */
  credit: number
  /** Still due on the old invoice after the move */
  owed: number
  /** The old invoice's new total */
  newTotal: number
  /** Unpaid part of the old invoice that is cancelled */
  cancelled: number
}

export function computeTransferMoney(i: TransferMoneyInput): TransferMoney {
  const total = round2(Math.max(0, i.totalAmount))
  const paid = round2(i.paidAmount)
  const netPaid = round2(i.paidAmount - i.refundedAmount)
  const cycle = i.sessionsInCycle && i.sessionsInCycle > 0 ? i.sessionsInCycle : null
  const perSession = cycle ? round2(total / cycle) : 0
  const sessions = Math.max(0, i.sessionsCounted)
  // The whole cycle used = the whole invoice (no rounding left-overs).
  const consumed = cycle && sessions >= cycle ? total : round2(Math.min(total, perSession * sessions))
  const credit = round2(Math.max(0, netPaid - consumed))
  const owed = round2(Math.max(0, consumed - netPaid))
  // After the credit is refunded: remaining (total - paid) must equal owed.
  const newTotal = round2(Math.min(total, paid + owed))
  return { perSession, sessionsCounted: sessions, consumed, netPaid, credit, owed, newTotal, cancelled: round2(total - newTotal) }
}

// ── discounts: what to suggest for each of the student's discounts ──────────
export type DiscountAction = 'MOVE' | 'KEEP' | 'END'

export interface AssignmentForTransfer {
  studentId: string | null
  classSectionId: string | null
  trackId: string | null
}

export interface TransferTargets {
  fromClassSectionId: string
  toTrackId: string | null
  /** Does the discount type's own scope (track/course/level/group) fit the new group? */
  typeFitsNewGroup: boolean
}

/**
 * Which actions make sense, and which one we suggest, for one discount.
 * Returns null for discounts that are not affected (another group's, or a
 * whole-group discount, which belongs to the group and never moves).
 */
export function discountOptions(a: AssignmentForTransfer, t: TransferTargets): { options: DiscountAction[]; suggested: DiscountAction } | null {
  if (!a.studentId) return null
  if (a.classSectionId) {
    if (a.classSectionId !== t.fromClassSectionId) return null
    return { options: ['MOVE', 'END'], suggested: t.typeFitsNewGroup ? 'MOVE' : 'END' }
  }
  if (a.trackId) {
    const sameTrack = !!t.toTrackId && a.trackId === t.toTrackId
    return { options: ['KEEP', 'END'], suggested: sameTrack ? 'KEEP' : 'END' }
  }
  // On the student everywhere (manual, sibling...): stays. Its type's own
  // scope still decides where it applies, so it is never lost by keeping it.
  return { options: ['KEEP', 'END'], suggested: 'KEEP' }
}
