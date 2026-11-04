'use client'

/** a02 M4: parent tab: this child's recorded courses: until when, progress, and renewing a subscription (the invoice goes to the Invoices tab). */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { L, useI18n } from '@/lib/i18n/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

export interface PortalCourse {
  id: string; level: string; plan: string; state: 'OPEN' | 'NOT_PAID' | 'EXPIRED'; endsAt: string | null; canRenew: boolean; unpaidRenewal: boolean; price: number | null; days: number | null
  progress: { done: number; total: number; pct: number; certificate: { isRevealed: boolean } | null } | null
}

const date = (d: string) => new Date(d).toLocaleDateString(L('en-GB', 'ar-EG-u-nu-latn'), { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Cairo' })

export function ChildRecordedCard({ studentId, courses }: { studentId: string; courses: PortalCourse[] }) {
  useI18n()
  const qc = useQueryClient()
  const renew = useMutation({
    mutationFn: (groupId: string) => fetchApi('/api/guardian-portal/recorded', { method: 'POST', body: JSON.stringify({ studentId, groupId }) }),
    onSuccess: () => { notify.success(L('The invoice is in the Invoices tab. The days start when it is paid.', 'الفاتورة في تبويب الفواتير، والأيام بتبدأ لما تتدفع.')); qc.invalidateQueries({ queryKey: ['portal-recorded', studentId] }); qc.invalidateQueries({ queryKey: ['guardian-child-academic', studentId] }) },
    onError: (e: Error) => notify.error(e.message),
  })
  return (
    <div className="space-y-3">
      {courses.map((c) => (
        <Card key={c.id}><CardContent className="flex flex-wrap items-center justify-between gap-3 pt-4 text-sm">
          <div className="min-w-0 space-y-1">
            <p className="font-semibold">{c.level}</p>
            <p className="text-slate-600">
              {c.plan === 'ONE_TIME' ? L('One-time purchase', 'شراء مرة واحدة') : c.endsAt ? `${L(c.state === 'EXPIRED' ? 'Ended on' : 'Open until', c.state === 'EXPIRED' ? 'خلص يوم' : 'مفتوح لحد')} ${date(c.endsAt)}` : L('Opens when the invoice is paid', 'بيفتح لما الفاتورة تتدفع')}
            </p>
            {c.progress && <p className="text-slate-600">{L(`${c.progress.done} of ${c.progress.total} done`, `${c.progress.done} من ${c.progress.total} خلصوا`)} ({c.progress.pct}%){c.progress.certificate?.isRevealed ? ` · ${L('Certificate ready', 'الشهادة جاهزة')}` : ''}</p>}
            {c.unpaidRenewal && <p className="text-xs text-amber-700">{L('An invoice is waiting in the Invoices tab', 'فيه فاتورة مستنية في تبويب الفواتير')}</p>}
          </div>
          {c.canRenew && (
            <Button size="sm" disabled={renew.isPending} onClick={() => renew.mutate(c.id)}>
              {L('Renew', 'جدّد')} · {(c.price ?? 0).toLocaleString('en-US')} {L('EGP', 'ج.م')} / {c.days} {L('days', 'يوم')}
            </Button>
          )}
        </CardContent></Card>
      ))}
    </div>
  )
}
