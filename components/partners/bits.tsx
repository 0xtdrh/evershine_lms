'use client'

/** M1 partners — small shared pieces (type label, contract state badge). */

import { L } from '@/lib/i18n/client'
import { PARTNER_KIND_LABELS, type PartnerKind } from '@/lib/partners/rules'

export const kindLabel = (k: string) => { const x = PARTNER_KIND_LABELS[k as PartnerKind]; return x ? L(x.en, x.ar) : k }

export function ContractBadge({ state, daysLeft }: { state: string; daysLeft: number | null }) {
  const map: Record<string, [string, string, string]> = {
    ACTIVE: ['Active', 'ساري', 'bg-emerald-50 text-emerald-700'],
    OPEN_ENDED: ['Open-ended', 'مفتوح', 'bg-emerald-50 text-emerald-700'],
    ENDING_SOON: ['Ends soon', 'قرب ينتهي', 'bg-amber-50 text-amber-700'],
    ENDED: ['Ended', 'انتهى', 'bg-rose-50 text-rose-700'],
    NOT_STARTED: ['Not started', 'لسه مبدأش', 'bg-slate-100 text-slate-600'],
  }
  const [en, ar, cls] = map[state] ?? [state, state, 'bg-slate-100 text-slate-600']
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${cls}`}>{L(en, ar)}{state === 'ENDING_SOON' && daysLeft !== null ? ` · ${daysLeft} ${L('days', 'يوم')}` : ''}</span>
}
