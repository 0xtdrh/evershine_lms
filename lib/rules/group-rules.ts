/**
 * Rules & policies (2026-10-16): the rules of a group, as plain sentences (Arabic + English).
 * Automatic rules come from the group's settings, then the written rules of the company, the place, the level and the
 * group are added (in that order). Pure (no database), tested in tests/group-rules.test.ts.
 * The parent accepts the exact list: `rulesFingerprint` changes when any rule changes, so the parent is asked again.
 */

export interface RuleItem { source: 'AUTO' | 'GLOBAL' | 'CAMPUS' | 'LEVEL' | 'GROUP'; en: string; ar: string }

export interface GroupRuleInput {
  group: {
    requireFullPaymentToStart: boolean; partialPaymentCounts: boolean; installmentsAllowed: boolean; maxStudents: number | null
    scheduleSlots: { dayOfWeek: number; time: string }[] | null; unnamedHeadcount: number | null
  }
  price: number | null
  pricingType: 'MONTHLY' | 'FULL_LEVEL' | null
  sessionsPerCycle: number | null
  refund: { allowed: boolean; adminFeeType: 'FIXED' | 'PERCENT'; adminFeeValue: number; deductBasis: 'ATTENDED' | 'HELD' }
  excuse: { autoApprove: boolean; daysAfter: number }
  written: { scope: 'GLOBAL' | 'CAMPUS' | 'LEVEL' | 'GROUP'; textEn: string; textAr: string; sortOrder: number }[]
}

const DAYS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const DAYS_AR = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']
const ORDER = { GLOBAL: 1, CAMPUS: 2, LEVEL: 3, GROUP: 4 }

export function buildGroupRules(i: GroupRuleInput): RuleItem[] {
  const out: RuleItem[] = []
  const add = (en: string, ar: string) => out.push({ source: 'AUTO', en, ar })
  const g = i.group
  if (Array.isArray(g.scheduleSlots) && g.scheduleSlots.length) {
    const s = [...g.scheduleSlots].sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.time.localeCompare(b.time))
    add(`Sessions: ${s.map((x) => `${DAYS_EN[x.dayOfWeek]} ${x.time}`).join(', ')}.`, `مواعيد الحصص: ${s.map((x) => `${DAYS_AR[x.dayOfWeek]} ${x.time}`).join('، ')}.`)
  }
  if (i.price !== null && i.price > 0 && g.unnamedHeadcount === null) {
    const per = i.pricingType === 'FULL_LEVEL' ? ['for the whole level', 'للمستوى كله'] : ['per month', 'في الشهر']
    const sess = i.sessionsPerCycle ? [` (${i.sessionsPerCycle} sessions)`, ` (${i.sessionsPerCycle} حصص)`] : ['', '']
    add(`Fee: ${i.price} EGP ${per[0]}${sess[0]}.`, `الرسوم: ${i.price} جنيه ${per[1]}${sess[1]}.`)
  }
  if (g.unnamedHeadcount === null) {
    if (g.requireFullPaymentToStart) add('The full fee must be paid before the group starts.', 'لازم تدفع الرسوم كاملة قبل بداية الجروب.')
    else if (g.partialPaymentCounts) add('Paying part of the fee is enough to start; the rest is paid during the month.', 'دفع جزء من الرسوم كفاية للبداية، والباقي بيتدفع خلال الشهر.')
    add(
      g.installmentsAllowed ? 'Paying in instalments is allowed.' : 'Paying in instalments is not allowed: each invoice is paid in full.',
      g.installmentsAllowed ? 'التقسيط مسموح.' : 'التقسيط مش مسموح: كل فاتورة بتتدفع كاملة.',
    )
    add('A student who has not paid by the middle of the month may be excluded from the group.', 'الطالب اللي مادفعش لحد نص الشهر ممكن يتشال من الجروب.')
  }
  if (g.maxStudents) add(`At most ${g.maxStudents} students in the group; when it is full, new students go on the waiting list.`, `أقصى عدد في الجروب ${g.maxStudents} طالب، ولو اتملى الطلاب الجداد بيدخلوا قايمة الانتظار.`)
  add(
    'An absence counts as a used session.',
    'الغياب بيتحسب من الحصص.',
  )
  add(
    i.excuse.autoApprove
      ? `An absence excuse sent from the portal (up to ${i.excuse.daysAfter} days after the session) is accepted automatically.`
      : `An absence excuse sent from the portal (up to ${i.excuse.daysAfter} days after the session) is reviewed by TechNova.`,
    i.excuse.autoApprove
      ? `عذر الغياب من البوابة (لحد ${i.excuse.daysAfter} يوم بعد الحصة) بيتقبل تلقائي.`
      : `عذر الغياب من البوابة (لحد ${i.excuse.daysAfter} يوم بعد الحصة) بتراجعه TechNova.`,
  )
  if (!i.refund.allowed) add('Fees are not refunded for this group.', 'الرسوم مابتترجعش في الجروب ده.')
  else {
    const basis = i.refund.deductBasis === 'HELD' ? ['sessions held', 'الحصص اللي اتعملت'] : ['sessions attended', 'الحصص اللي حضرها']
    const fee = i.refund.adminFeeValue > 0
      ? (i.refund.adminFeeType === 'PERCENT' ? [` and an administration fee of ${i.refund.adminFeeValue}%`, ` ومصاريف إدارية ${i.refund.adminFeeValue}%`] : [` and an administration fee of ${i.refund.adminFeeValue} EGP`, ` ومصاريف إدارية ${i.refund.adminFeeValue} جنيه`])
      : ['', '']
    add(`A refund is the amount paid minus the ${basis[0]}${fee[0]}; it can go back as cash or to the wallet.`, `الاسترداد = المدفوع ناقص ${basis[1]}${fee[1]}، ويرجع كاش أو في المحفظة.`)
  }
  const written = [...i.written].sort((a, b) => ORDER[a.scope] - ORDER[b.scope] || a.sortOrder - b.sortOrder)
  for (const w of written) out.push({ source: w.scope, en: w.textEn.trim(), ar: w.textAr.trim() || w.textEn.trim() })
  return out
}

/** A stable text of the rules (both languages) — hashed by the server to know if the parent accepted THIS list. */
export function rulesFingerprintText(items: RuleItem[]): string {
  return items.map((x) => `${x.source}|${x.en}|${x.ar}`).join('\n')
}
