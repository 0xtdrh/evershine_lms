'use client'

/** 2026-10-18 data health check — problems that cause wrong bills, missing lessons or lost parents, with links to fix. */

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { L, useI18n } from '@/lib/i18n/client'
import { useMyPermissions } from '@/hooks/use-my-permissions'
import { AccessDenied } from '@/components/AccessDenied'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { CheckCircle2, HeartPulse, Loader2, RefreshCw } from 'lucide-react'

interface Check { key: string; en: string; ar: string; fixEn: string; fixAr: string; severity: 'HIGH' | 'MEDIUM' | 'LOW'; count: number; items: { id: string; label: string; href: string }[] }

const SEV: Record<Check['severity'], [string, string, string]> = {
  HIGH: ['Fix first', 'صلّحها الأول', 'bg-rose-50 text-rose-700 border-rose-200'],
  MEDIUM: ['Important', 'مهم', 'bg-amber-50 text-amber-700 border-amber-200'],
  LOW: ['Good to fix', 'يستحسن', 'bg-slate-50 text-slate-600 border-slate-200'],
}

export default function DataHealthPage() {
  const { locale } = useI18n()
  const ar = locale === 'ar'
  const { can, ready, role } = useMyPermissions()
  const { data, isLoading, refetch, isFetching } = useQuery({ queryKey: ['data-health'], queryFn: () => fetchApi<{ checks: Check[]; problems: number }>('/api/data-health'), enabled: ready && can('audit_logs', 'read') })
  if (role && !ready) return null
  if (!can('audit_logs', 'read')) return <AccessDenied title={L('Data health', 'صحة البيانات')} message={L("You don't have access to the data health check.", 'مالكش صلاحية على فحص البيانات.')} />
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900"><HeartPulse className="h-7 w-7 text-indigo-600" /> {L('Data health', 'صحة البيانات')}</h1>
          <p className="mt-1 text-sm text-slate-500">{L('Problems in the data that cause wrong bills, missing lessons or lost parents. Open each one to fix it. Run it after entering the real data, then now and then.', 'مشاكل في البيانات بتعمل فواتير غلط أو دروس مش ظاهرة أو أولياء أمور مش واصلهم حاجة. افتح كل واحدة وصلّحها. شغّله بعد إدخال البيانات الحقيقية، وكل فترة.')}</p>
        </div>
        <Button size="sm" variant="outline" disabled={isFetching} onClick={() => refetch()}>{isFetching ? <Loader2 className="me-1 h-4 w-4 animate-spin" /> : <RefreshCw className="me-1 h-4 w-4" />}{L('Check again', 'افحص تاني')}</Button>
      </div>
      {isLoading || !data ? <Loader2 className="h-5 w-5 animate-spin text-slate-400" /> : (
        <>
          <p className={`text-sm font-semibold ${data.problems ? 'text-amber-700' : 'text-emerald-700'}`}>{data.problems ? L(`${data.problems} kinds of problems found`, `لقينا ${data.problems} نوع مشاكل`) : L('No problems found.', 'مفيش مشاكل.')}</p>
          <div className="space-y-3">
            {data.checks.map((c) => (
              <Card key={c.key} className={c.count ? '' : 'opacity-70'}>
                <CardContent className="space-y-2 pt-4 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    {c.count ? <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${SEV[c.severity][2]}`}>{ar ? SEV[c.severity][1] : SEV[c.severity][0]}</span> : <CheckCircle2 className="h-4 w-4 text-emerald-600" />}
                    <span className="font-semibold text-slate-800">{ar ? c.ar : c.en}</span>
                    <span className="ms-auto text-lg font-bold tabular-nums text-slate-900">{c.count}</span>
                  </div>
                  {c.count > 0 && (
                    <>
                      <p className="text-xs text-slate-500">{ar ? c.fixAr : c.fixEn}</p>
                      <div className="flex flex-wrap gap-2">
                        {c.items.map((i) => <Link key={i.id} href={i.href} className="rounded-lg border border-slate-200 px-2 py-1 text-xs text-indigo-700 hover:bg-indigo-50">{i.label}</Link>)}
                        {c.count > c.items.length && <span className="text-xs text-slate-500">{L(`+ ${c.count - c.items.length} more`, `+ ${c.count - c.items.length} كمان`)}</span>}
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
