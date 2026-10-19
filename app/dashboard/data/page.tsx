'use client'

/**
 * Phase 6 — Import & Export centre: every table the person may take out (Excel / PDF) or bring in (Excel template),
 * with an optional date range, and the log of who imported / exported what.
 * The same buttons also sit on each table's own screen (DataExchangeButtons).
 */

import { useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { L, useI18n } from '@/lib/i18n/client'
import { DATASETS } from '@/lib/data-exchange/registry'
import { DataExchangeButtons, useDataRights } from '@/components/data/DataExchangeButtons'
import { ArrowLeftRight, Loader2 } from 'lucide-react'
import { DateInput } from '@/components/ui/date-input'

interface LogRow { id: string; kind: string; dataset: string; format: string | null; fileName: string | null; rows: number; created: number; failed: number; user: string; createdAt: string }

export default function DataCentrePage() {
  const ar = useI18n().locale === 'ar'
  const { data: rights, isLoading } = useDataRights()
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const { data: log } = useQuery({ queryKey: ['data-log'], queryFn: () => fetchApi<LogRow[]>('/api/data/log'), retry: false })
  const mine = DATASETS.filter((d) => rights?.some((r) => r.key === d.key))
  const name = (k: string) => { const d = DATASETS.find((x) => x.key === k); return d ? (ar ? d.ar : d.en) : k }
  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900"><ArrowLeftRight className="h-7 w-7 text-indigo-600" /> {L('Import & Export', 'الاستيراد والتصدير')}</h1>
        <p className="mt-1 text-sm text-slate-500">{L('Take any table out as Excel or PDF with the TechNova logo, or add many rows at once from an Excel template. Who may do what is set on the Permissions page (role, place or person).', 'طلّع أي جدول Excel أو PDF بلوجو TechNova، أو ضيف صفوف كتير مرة واحدة من قالب Excel. مين يقدر يعمل إيه بيتظبط من صفحة الصلاحيات (للدور أو المكان أو الشخص).')}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-slate-600">{L('Dates for exports (optional):', 'تواريخ التصدير (اختياري):')}</span>
        <DateInput className="h-8 w-40" value={from} onChange={(e) => setFrom(e.target.value)} />
        <span>→</span>
        <DateInput className="h-8 w-40" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>
      {isLoading && <Loader2 className="h-5 w-5 animate-spin text-slate-400" />}
      {!isLoading && !mine.length && <p className="text-sm text-slate-500">{L('You have no import / export permission.', 'مالكش صلاحية استيراد أو تصدير.')}</p>}
      <div className="grid gap-3 md:grid-cols-2">
        {mine.map((d) => (
          <Card key={d.key}><CardContent className="space-y-2 pt-4">
            <div className="flex items-start justify-between gap-2">
              <p className="font-semibold text-slate-800">{ar ? d.ar : d.en}</p>
              <Link href={d.page} className="text-xs text-indigo-700 hover:underline">{L('Open the screen', 'افتح الشاشة')}</Link>
            </div>
            <p className="text-xs text-slate-500">{ar ? d.descAr : d.descEn}</p>
            <DataExchangeButtons dataset={d.key} filters={d.filters?.includes('from') ? { from, to } : {}} />
          </CardContent></Card>
        ))}
      </div>
      {!!log?.length && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-slate-500">{L('Recent imports & exports', 'آخر استيراد وتصدير')}</h2>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-500"><tr>
                <th className="p-2 text-start">{L('When', 'إمتى')}</th><th className="p-2 text-start">{L('Who', 'مين')}</th><th className="p-2 text-start">{L('What', 'إيه')}</th>
                <th className="p-2 text-start">{L('Table', 'الجدول')}</th><th className="p-2 text-start">{L('Rows', 'السطور')}</th>
              </tr></thead>
              <tbody>
                {log.map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="p-2">{new Date(r.createdAt).toLocaleString(ar ? 'ar-EG' : 'en-GB', { dateStyle: 'short', timeStyle: 'short' })}</td>
                    <td className="p-2">{r.user}</td>
                    <td className="p-2">{r.kind === 'IMPORT' ? L('Import', 'استيراد') : `${L('Export', 'تصدير')} ${(r.format ?? '').toUpperCase()}`}{r.fileName ? ` · ${r.fileName}` : ''}</td>
                    <td className="p-2">{name(r.dataset)}</td>
                    <td className="p-2">{r.kind === 'IMPORT' ? <>{r.created} ✓ {r.failed ? <span className="text-rose-600">· {r.failed} ✗</span> : null}</> : r.rows}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
