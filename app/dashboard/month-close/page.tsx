'use client'

/**
 * a03 month close (2026-10-26) — close a finished month for the whole company or one branch, after checking what is
 * still waiting; the monthly financial report of each month (frozen when closed); a Super Admin reopens with a reason;
 * settings for the automatic close. Tabs open from links (?tab=settings).
 */

import { useState } from 'react'
import Link from 'next/link'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { L, useI18n } from '@/lib/i18n/client'
import { useUrlTab } from '@/hooks/use-url-tab'
import { monthName, type MonthCloseSettings } from '@/lib/month-close/rules'
import type { MonthRow } from '@/lib/month-close/engine'
import { CalendarCheck, FileText, Loader2, Lock, LockOpen } from 'lucide-react'

interface ListData {
  scopes: { campusId: string | null; name: string }[]
  rows: MonthRow[]
  settings: MonthCloseSettings
  can: { close: boolean; reopen: boolean; settings: boolean }
}
interface PendingData { total: number; items: { key: string; count: number; en: string; ar: string; href: string }[] }

const scopeName = (s: { campusId: string | null; name: string }) => (s.campusId ? s.name : L('Whole company', 'الشركة كلها'))
const fmt = (iso: string | null, ar: boolean) => (iso ? new Date(iso).toLocaleDateString(ar ? 'ar-EG-u-nu-latn' : 'en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Africa/Cairo' }) : '')

function StatusBadge({ r }: { r: MonthRow }) {
  if (r.status === 'LOCKED') return (
    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
      <Lock className="h-3 w-3" />{r.byCompany ? L('Closed (whole company)', 'مقفول (الشركة كلها)') : r.auto ? L('Closed automatically', 'اتقفل تلقائي') : L('Closed', 'مقفول')}
    </span>
  )
  if (r.status === 'OPEN') return <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700"><LockOpen className="h-3 w-3" />{L('Reopened', 'اتفتح تاني')}</span>
  return <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-500">{L('Open', 'مفتوح')}</span>
}

function ClosePanel({ ym, scope, onDone }: { ym: string; scope: { campusId: string | null; name: string }; onDone: () => void }) {
  const ar = useI18n().locale === 'ar'
  const q = `ym=${ym}${scope.campusId ? `&campusId=${scope.campusId}` : ''}`
  const { data, isLoading } = useQuery({ queryKey: ['month-close-pending', q], queryFn: () => fetchApi<PendingData>(`/api/month-close/pending?${q}`) })
  const close = useMutation({
    mutationFn: () => fetchApi('/api/month-close', { method: 'POST', body: JSON.stringify({ ym, campusId: scope.campusId }) }),
    onSuccess: () => { notify.success(L('Month closed — its report is saved', 'الشهر اتقفل — والتقرير بتاعه اتحفظ')); onDone() },
    onError: (e: Error) => notify.error(e.message),
  })
  return (
    <div className="mt-2 rounded-lg border border-indigo-200 bg-indigo-50/40 p-3 text-sm">
      <p className="font-semibold">{L('Before closing', 'قبل القفل')} — {monthName(ym, ar ? 'ar' : 'en')} · {scopeName(scope)}</p>
      {isLoading && <Loader2 className="mt-2 h-4 w-4 animate-spin text-slate-400" />}
      {data && data.total === 0 && <p className="mt-1 text-emerald-700">✓ {L('Nothing of this month is waiting.', 'مفيش حاجة من الشهر ده مستنية.')}</p>}
      {data && data.total > 0 && (
        <ul className="mt-1 space-y-1">
          {data.items.map((i) => (
            <li key={i.key} className="flex items-center justify-between gap-2 text-amber-800">
              <span>⚠ {ar ? i.ar : i.en}: <b>{i.count}</b></span>
              <Link href={i.href} className="text-xs font-semibold text-indigo-700 underline">{L('Open', 'افتح')}</Link>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-xs text-slate-600">{L('After closing, nothing dated in this month can be added, changed or deleted, and the monthly report is saved as it is now. A late payment on an old invoice is still recorded — in the current month.', 'بعد القفل محدش يقدر يضيف أو يعدّل أو يمسح حاجة بتاريخ الشهر ده، والتقرير الشهري بيتحفظ زي ما هو دلوقتي. الدفعة المتأخرة على فاتورة قديمة بتتسجل عادي — في الشهر الحالي.')}</p>
      <div className="mt-2 flex gap-2">
        <Button size="sm" disabled={!data || close.isPending} onClick={() => close.mutate()}>
          {close.isPending ? <Loader2 className="me-1 h-4 w-4 animate-spin" /> : <Lock className="me-1 h-4 w-4" />}
          {data && data.total > 0 ? L('Close anyway', 'اقفل برضه') : L('Close the month', 'اقفل الشهر')}
        </Button>
        <Button size="sm" variant="outline" onClick={onDone}>{L('Cancel', 'إلغاء')}</Button>
      </div>
    </div>
  )
}

function ReopenPanel({ ym, scope, onDone }: { ym: string; scope: { campusId: string | null }; onDone: () => void }) {
  const [reason, setReason] = useState('')
  const reopen = useMutation({
    mutationFn: () => fetchApi('/api/month-close/reopen', { method: 'POST', body: JSON.stringify({ ym, campusId: scope.campusId, reason }) }),
    onSuccess: () => { notify.success(L('Month reopened', 'الشهر اتفتح')); onDone() },
    onError: (e: Error) => notify.error(e.message),
  })
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50/50 p-3 text-sm">
      <Input aria-label={L('Why reopen?', 'سبب الفتح')} className="h-9 max-w-md flex-1" placeholder={L('Why is it reopened? (kept in the history)', 'ليه بتفتحه؟ (بيتسجل)')} value={reason} onChange={(e) => setReason(e.target.value)} />
      <Button size="sm" variant="outline" disabled={reason.trim().length < 5 || reopen.isPending} onClick={() => reopen.mutate()}><LockOpen className="me-1 h-4 w-4" />{L('Reopen', 'افتح الشهر')}</Button>
      <Button size="sm" variant="ghost" onClick={onDone}>{L('Cancel', 'إلغاء')}</Button>
    </div>
  )
}

function SettingsTab({ s, canSave }: { s: MonthCloseSettings; canSave: boolean }) {
  const qc = useQueryClient()
  const [v, setV] = useState(s)
  const save = useMutation({
    mutationFn: () => fetchApi('/api/month-close/settings', { method: 'PUT', body: JSON.stringify(v) }),
    onSuccess: () => { notify.success(L('Saved', 'اتحفظ')); qc.invalidateQueries({ queryKey: ['month-close'] }) },
    onError: (e: Error) => notify.error(e.message),
  })
  return (
    <Card><CardContent className="space-y-3 p-4 text-sm">
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={v.autoLock} disabled={!canSave} onChange={(e) => setV({ ...v, autoLock: e.target.checked })} />
        {L('Close last month automatically (whole company)', 'اقفل الشهر اللي فات تلقائياً (الشركة كلها)')}
      </label>
      <label className="flex items-center gap-2">
        {L('On day', 'يوم')}
        <Input type="number" min={1} max={28} className="h-8 w-20" value={v.autoLockDay} disabled={!canSave} onChange={(e) => setV({ ...v, autoLockDay: Number(e.target.value) })} />
        {L('of the next month', 'من الشهر اللي بعده')}
      </label>
      <p className="text-xs text-slate-500">{L('The automatic close waits while something of that month is still waiting (receipts, refunds, expenses, salary slips…), and never closes again a month a Super Admin reopened.', 'القفل التلقائي بيستنى لو في حاجة من الشهر لسه مستنية (إيصالات، استرداد، مصاريف، قسايم مرتبات…)، وعمره ما يقفل تاني شهر الـ Super Admin فتحه.')}</p>
      <label className="flex items-center gap-2">
        {L('Remind in "your work today" from day', 'فكّرني في «شغلك النهارده» من يوم')}
        <Input type="number" min={1} max={28} className="h-8 w-20" value={v.remindDay} disabled={!canSave} onChange={(e) => setV({ ...v, remindDay: Number(e.target.value) })} />
      </label>
      {canSave && <Button size="sm" disabled={save.isPending} onClick={() => save.mutate()}>{L('Save', 'احفظ')}</Button>}
    </CardContent></Card>
  )
}

export default function MonthClosePage() {
  const ar = useI18n().locale === 'ar'
  const qc = useQueryClient()
  const [tab, setTab] = useUrlTab()
  const { data, isLoading, error } = useQuery({ queryKey: ['month-close'], queryFn: () => fetchApi<ListData>('/api/month-close?months=12') })
  const [scopeIdx, setScopeIdx] = useState(0)
  const [open, setOpen] = useState<{ ym: string; kind: 'close' | 'reopen' } | null>(null)
  const scope = data?.scopes[scopeIdx] ?? data?.scopes[0]
  const rows = (data?.rows ?? []).filter((r) => scope && r.campusId === scope.campusId)
  const done = () => { setOpen(null); ['month-close', 'month-close-pending', 'today-tasks'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })) }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900"><CalendarCheck className="h-7 w-7 text-indigo-600" /> {L('Month close', 'قفل الشهر المالي')}</h1>
        <p className="mt-1 text-sm text-slate-500">{L('Close a finished month so its numbers never change, and keep its monthly financial report.', 'اقفل الشهر اللي خلص عشان أرقامه متتغيرش، واحتفظ بالتقرير المالي الشهري بتاعه.')}</p>
      </div>
      {error && <p className="text-sm text-rose-600">{(error as Error).message}</p>}
      <Tabs value={tab ?? 'months'} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="months">{L('Months', 'الشهور')}</TabsTrigger>
          {data?.can.settings && <TabsTrigger value="settings">{L('Settings', 'الإعدادات')}</TabsTrigger>}
        </TabsList>

        <TabsContent value="months" className="mt-4 space-y-3">
          {isLoading && <Loader2 className="h-5 w-5 animate-spin text-slate-400" />}
          {data && data.scopes.length > 1 && (
            <select aria-label={L('Company or branch', 'الشركة أو الفرع')} className="h-9 rounded-md border px-2 text-sm" value={scopeIdx} onChange={(e) => { setScopeIdx(Number(e.target.value)); setOpen(null) }}>
              {data.scopes.map((s, i) => <option key={s.campusId ?? 'ALL'} value={i}>{scopeName(s)}</option>)}
            </select>
          )}
          {data && scope && (
            <Card><CardContent className="divide-y p-0">
              {rows.map((r) => (
                <div key={r.ym} className="p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-semibold text-slate-900">{monthName(r.ym, ar ? 'ar' : 'en')} <span className="ms-2 align-middle"><StatusBadge r={r} /></span></p>
                      {r.status === 'LOCKED' && <p className="text-xs text-slate-500">{L('Closed', 'اتقفل')} {fmt(r.lockedAt, ar)}{r.lockedBy ? ` · ${r.lockedBy}` : ''}</p>}
                      {r.status === 'OPEN' && r.reopenReason && <p className="text-xs text-amber-700">{L('Reopened', 'اتفتح')} {fmt(r.reopenedAt, ar)}: {r.reopenReason}</p>}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Link href={`/reports/month/${r.ym}${scope.campusId ? `?campusId=${scope.campusId}` : ''}`} target="_blank">
                        <Button size="sm" variant="outline"><FileText className="me-1 h-4 w-4" />{L('Monthly report', 'التقرير الشهري')}</Button>
                      </Link>
                      {data.can.close && r.status !== 'LOCKED' && <Button size="sm" onClick={() => setOpen({ ym: r.ym, kind: 'close' })}><Lock className="me-1 h-4 w-4" />{L('Check & close', 'راجع واقفل')}</Button>}
                      {data.can.reopen && r.status === 'LOCKED' && !r.byCompany && <Button size="sm" variant="outline" onClick={() => setOpen({ ym: r.ym, kind: 'reopen' })}><LockOpen className="me-1 h-4 w-4" />{L('Reopen', 'افتح')}</Button>}
                    </div>
                  </div>
                  {open?.ym === r.ym && open.kind === 'close' && <ClosePanel ym={r.ym} scope={scope} onDone={done} />}
                  {open?.ym === r.ym && open.kind === 'reopen' && <ReopenPanel ym={r.ym} scope={scope} onDone={done} />}
                </div>
              ))}
            </CardContent></Card>
          )}
          {data?.scopes.some((s) => s.campusId === null) && scope?.campusId && (
            <p className="text-xs text-slate-500">{L('A month closed for the whole company is closed for every branch too; reopen it from "Whole company".', 'الشهر المقفول للشركة كلها مقفول لكل الفروع؛ افتحه من «الشركة كلها».')}</p>
          )}
        </TabsContent>

        {data?.can.settings && (
          <TabsContent value="settings" className="mt-4"><SettingsTab s={data.settings} canSave={data.can.settings} /></TabsContent>
        )}
      </Tabs>
    </div>
  )
}
