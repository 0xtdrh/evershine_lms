'use client'

/**
 * FIN-3 tabs of the Accounts & cash boxes page: cash flow (+ 30-day forecast), where every pound went, and bank
 * reconciliation (upload the bank statement, confirm the matches). Printable (the page's print hides the rest).
 */

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { L, useI18n } from '@/lib/i18n/client'
import { MOVEMENT_KIND_LABEL, type MovementKind } from '@/lib/treasury/rules'
import { AlertTriangle, Loader2, Printer, Upload } from 'lucide-react'
import { DateInput } from '@/components/ui/date-input'
import { cairoToday } from '@/lib/dates/cairo'

const useMoney = () => {
  const ar = useI18n().locale === 'ar'
  return { ar, money: (n: number) => `${n.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${ar ? 'ج.م' : 'EGP'}` }
}
const kindName = (k: string, ar: boolean) => { const x = MOVEMENT_KIND_LABEL[k as MovementKind]; return x ? (ar ? x[1] : x[0]) : k }

// ── cash flow ────────────────────────────────────────────────────────────────────────────────────────────────
interface FlowRow { month: string; in: number; out: number; net: number; running: number; byKind: Record<string, { in: number; out: number }> }
interface Flow { months: FlowRow[]; forecast: { expectedIn: number; overdue: number; expectedOut: number; balanceNow: number; balanceAfter: number; basisMonths: number }; prepaid: number }

export function CashflowTab() {
  const { ar, money } = useMoney()
  const [months, setMonths] = useState(6)
  const { data, isLoading } = useQuery({ queryKey: ['cashflow', months], queryFn: () => fetchApi<Flow>(`/api/finance/cashflow?months=${months}`) })
  if (isLoading || !data) return <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
  const max = Math.max(1, ...data.months.flatMap((r) => [r.in, r.out]))
  const f = data.forecast
  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <select className="h-9 rounded-md border border-slate-200 bg-white px-2" value={months} onChange={(e) => setMonths(Number(e.target.value))}>
          {[3, 6, 12].map((n) => <option key={n} value={n}>{n} {L('months', 'شهور')}</option>)}
        </select>
        <Button size="sm" variant="outline" onClick={() => window.print()}><Printer className="me-1 h-4 w-4" /> {L('Print', 'طباعة')}</Button>
      </div>
      <Card className={f.basisMonths && f.balanceAfter < 0 ? 'border-rose-300' : ''}><CardContent className="grid gap-3 pt-4 sm:grid-cols-4">
        <Stat label={L('In the accounts now', 'في الحسابات دلوقتي')} value={money(f.balanceNow)} />
        <Stat label={L('Expected in — next 30 days', 'داخل متوقع — 30 يوم')} value={money(f.expectedIn)} hint={f.overdue ? `${L('+ overdue not counted', '+ متأخر مش محسوب')}: ${money(f.overdue)}` : undefined} />
        <Stat label={L('Expected out (average)', 'خارج متوقع (متوسط)')} value={money(f.expectedOut)} hint={L(`average of the last ${f.basisMonths} months`, `متوسط آخر ${f.basisMonths} شهور`)} />
        <Stat label={L('After 30 days', 'بعد 30 يوم')} value={money(f.balanceAfter)} tone={f.balanceAfter < 0 ? 'text-rose-600' : 'text-emerald-700'} />
        {f.basisMonths > 0 && f.balanceAfter < 0 && <p className="flex items-center gap-1 text-rose-700 sm:col-span-4"><AlertTriangle className="h-4 w-4" /> {L('The money expected may not cover the usual spending next month — follow up unpaid invoices or delay spending.', 'الفلوس المتوقعة ممكن ماتكفيش مصاريف الشهر الجاي العادية — تابع الفواتير المتأخرة أو أجّل الصرف.')}</p>}
        <p className="text-xs text-slate-500 sm:col-span-4">{L('Wallet money families paid in advance (owed to them until used)', 'فلوس المحافظ اللي الأهالي دفعوها مقدّم (لسه حقهم لحد ما تتصرف)')}: <b>{money(data.prepaid)}</b></p>
      </CardContent></Card>
      <div className="overflow-x-auto rounded-xl border bg-white">
        <table className="w-full text-start">
          <thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="p-2 text-start">{L('Month', 'الشهر')}</th><th className="p-2 text-start">{L('In', 'داخل')}</th><th className="p-2 text-start">{L('Out', 'خارج')}</th><th className="p-2 text-start">{L('Net', 'الصافي')}</th><th className="p-2 text-start">{L('Running total', 'التراكمي')}</th><th className="w-1/3 p-2 print:hidden" /></tr></thead>
          <tbody>
            {data.months.map((r) => (
              <tr key={r.month} className="border-t align-top">
                <td className="p-2 font-medium">{r.month}</td>
                <td className="p-2 text-emerald-700">{money(r.in)}</td>
                <td className="p-2 text-rose-700">{money(r.out)}<div className="text-[11px] text-slate-500">{Object.entries(r.byKind).filter(([, v]) => v.out).map(([k, v]) => `${kindName(k, ar)} ${money(v.out)}`).join(' · ')}</div></td>
                <td className={`p-2 font-semibold ${r.net < 0 ? 'text-rose-600' : 'text-slate-800'}`}>{money(r.net)}</td>
                <td className="p-2">{money(r.running)}</td>
                <td className="p-2 print:hidden"><div className="h-2 rounded bg-emerald-500" style={{ width: `${(r.in / max) * 100}%` }} /><div className="mt-1 h-2 rounded bg-rose-500" style={{ width: `${(r.out / max) * 100}%` }} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">{L('Transfers between our own accounts are left out. Wallet payments are not counted twice (the money came in when the wallet was topped up).', 'التحويلات بين حساباتنا مش محسوبة. ودفع الفواتير من المحفظة مش بيتحسب مرتين (الفلوس دخلت وقت الشحن).')}</p>
    </div>
  )
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: string }) {
  return <div><p className="text-xs text-slate-500">{label}</p><p className={`text-xl font-bold ${tone ?? 'text-slate-900'}`}>{value}</p>{hint && <p className="text-[11px] text-slate-500">{hint}</p>}</div>
}

// ── where every pound went ───────────────────────────────────────────────────────────────────────────────────
interface Pound { key: string; category?: string; categoryAr?: string; amount: number; pct: number }
interface Where { from: string; to: string; in: Pound[]; out: Pound[]; totalIn: number; totalOut: number; kept: number; keptPct: number; now: { balance: number; prepaid: number; unplaced: number; free: number } }

export function WhereMoneyTab() {
  const { ar, money } = useMoney()
  const today = cairoToday()
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`)
  const [to, setTo] = useState(today)
  const { data, isLoading } = useQuery({ queryKey: ['where-money', from, to], queryFn: () => fetchApi<Where>(`/api/finance/where?from=${from}&to=${to}`) })
  const name = (p: Pound) => (p.category ? `${kindName('EXPENSE', ar)}: ${ar ? p.categoryAr ?? p.category : p.category}` : p.key === 'PAYMENT' ? L('Invoice payments', 'دفع الفواتير') : kindName(p.key, ar))
  const bar = (p: Pound, tone: string) => (
    <div key={`${p.key}-${p.category ?? ''}`} className="space-y-1">
      <div className="flex justify-between gap-2"><span>{name(p)}</span><span className="font-semibold">{money(p.amount)} <span className="text-xs font-normal text-slate-500">({p.pct}%)</span></span></div>
      <div className="h-2 rounded bg-slate-100"><div className={`h-2 rounded ${tone}`} style={{ width: `${Math.min(100, p.pct)}%` }} /></div>
    </div>
  )
  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <DateInput className="h-9 w-40" value={from} onChange={(e) => setFrom(e.target.value)} />
        <DateInput className="h-9 w-40" value={to} onChange={(e) => setTo(e.target.value)} />
        <Button size="sm" variant="outline" onClick={() => window.print()}><Printer className="me-1 h-4 w-4" /> {L('Print', 'طباعة')}</Button>
      </div>
      {(isLoading || !data) ? <Loader2 className="h-5 w-5 animate-spin text-slate-400" /> : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Card><CardContent className="pt-4"><Stat label={L('Came in', 'دخل')} value={money(data.totalIn)} tone="text-emerald-700" /></CardContent></Card>
            <Card><CardContent className="pt-4"><Stat label={L('Went out', 'خرج')} value={money(data.totalOut)} tone="text-rose-700" /></CardContent></Card>
            <Card><CardContent className="pt-4"><Stat label={L('Kept', 'اتبقى')} value={money(data.kept)} hint={`${data.keptPct}% ${L('of what came in', 'من اللي دخل')}`} tone={data.kept < 0 ? 'text-rose-600' : 'text-slate-900'} /></CardContent></Card>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card><CardContent className="space-y-3 pt-4"><p className="font-semibold">{L('Where it came from', 'جت منين')}</p>{data.in.length ? data.in.map((p) => bar(p, 'bg-emerald-500')) : <p className="text-slate-500">—</p>}</CardContent></Card>
            <Card><CardContent className="space-y-3 pt-4"><p className="font-semibold">{L('Where every pound went', 'كل جنيه راح فين')}</p>{data.out.length ? data.out.map((p) => bar(p, 'bg-rose-500')) : <p className="text-slate-500">—</p>}</CardContent></Card>
          </div>
          <Card><CardContent className="grid gap-3 pt-4 sm:grid-cols-4">
            <Stat label={L('In the accounts now', 'في الحسابات دلوقتي')} value={money(data.now.balance)} />
            <Stat label={L('Of it: families\' wallets (owed)', 'منها: محافظ الأهالي (حقهم)')} value={money(data.now.prepaid)} />
            <Stat label={L('Free to use', 'المتاح فعلاً')} value={money(data.now.free)} tone={data.now.free < 0 ? 'text-rose-600' : 'text-emerald-700'} />
            <Stat label={L('Not placed in an account', 'مش متسجلة على حساب')} value={money(data.now.unplaced)} />
          </CardContent></Card>
        </>
      )}
    </div>
  )
}

// ── bank reconciliation ──────────────────────────────────────────────────────────────────────────────────────
interface StatusRow { id: string; name: string; kind: string; open: number; openIn: number; openOut: number; lastReconciledAt: string | null }
interface Line { row: number; date: string; amount: number; description: string; reference: string }
interface Mv { id: string; date: string; direction: string; amount: number; note: string | null; kind?: string }
interface Preview { matched: { line: Line; move: Mv }[]; already: number; bankOnly: Line[]; systemOnly: Mv[]; lines: number; skipped: number }

export function ReconcileTab() {
  const { ar, money } = useMoney()
  const qc = useQueryClient()
  const { data: accounts, isLoading } = useQuery({ queryKey: ['reconcile-status'], queryFn: () => fetchApi<StatusRow[]>('/api/treasury/reconcile') })
  const [accountId, setAccountId] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [skip, setSkip] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const compare = async () => {
    if (!accountId || !file) return notify.error(L('Choose the account and the statement file', 'اختار الحساب وملف الكشف'))
    setBusy(true)
    try {
      const form = new FormData(); form.append('accountId', accountId); form.append('file', file)
      const res = await fetch('/api/treasury/reconcile', { method: 'POST', body: form, credentials: 'same-origin' })
      const json = await res.json()
      if (!json.success) throw new Error(json.error?.message ?? json.message ?? 'Error')
      setPreview(json.data); setSkip(new Set())
    } catch (e) { notify.error((e as Error).message) } finally { setBusy(false) }
  }
  const confirm = useMutation({
    mutationFn: () => fetchApi<{ reconciled: number }>('/api/treasury/reconcile/confirm', { method: 'POST', body: JSON.stringify({ accountId, pairs: (preview?.matched ?? []).filter((m) => !skip.has(m.move.id)).map((m) => ({ moveId: m.move.id, bankRef: m.line.reference || m.line.description.slice(0, 100) || null })) }) }),
    onSuccess: (r) => { notify.success(`${L('Matched', 'اتطابق')}: ${r.reconciled}`); setPreview(null); setFile(null); qc.invalidateQueries({ queryKey: ['reconcile-status'] }) },
    onError: (e: Error) => notify.error(e.message),
  })
  const signed = (d: string, n: number) => (d === 'IN' ? `+${money(n)}` : `−${money(n)}`)
  if (isLoading) return <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
  if (!accounts?.length) return <p className="rounded-lg border border-dashed p-4 text-sm text-slate-600">{L('No bank or e-wallet accounts yet (Settings → Payments → Money accounts).', 'مفيش حسابات بنك أو محافظ إلكترونية لسه (الإعدادات ← الدفع ← حسابات الفلوس).')}</p>
  return (
    <div className="space-y-4 text-sm">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {accounts.map((a) => (
          <button key={a.id} type="button" onClick={() => setAccountId(a.id)} className={`rounded-xl border p-3 text-start ${accountId === a.id ? 'border-indigo-400 ring-2 ring-indigo-100' : 'border-slate-200 bg-white'}`}>
            <p className="font-semibold text-slate-800">{a.name}</p>
            <p className={a.open ? 'text-amber-700' : 'text-emerald-700'}>{a.open ? `${a.open} ${L('movements not matched with the bank', 'حركة مش متطابقة مع البنك')}` : L('All matched', 'كله متطابق')}</p>
            <p className="text-[11px] text-slate-500">↓ {money(a.openIn)} · ↑ {money(a.openOut)} · {L('last match', 'آخر مطابقة')}: {a.lastReconciledAt ? new Date(a.lastReconciledAt).toLocaleDateString(ar ? 'ar-EG-u-nu-latn' : 'en-GB') : '—'}</p>
          </button>
        ))}
      </div>
      <Card><CardContent className="space-y-2 pt-4">
        <p className="text-slate-600">{L('Download the statement from the bank as Excel or CSV (columns: date, amount or debit / credit, description, reference — English or Arabic), then upload it here.', 'نزّل كشف الحساب من البنك Excel أو CSV (أعمدة: التاريخ، المبلغ أو مدين / دائن، البيان، المرجع — عربي أو إنجليزي)، وارفعه هنا.')}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Input type="file" accept=".xlsx,.csv" className="h-9 max-w-xs" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null) }} />
          <Button size="sm" disabled={busy || !accountId || !file} onClick={compare}>{busy ? <Loader2 className="me-1 h-4 w-4 animate-spin" /> : <Upload className="me-1 h-4 w-4" />} {L('Compare', 'قارن')}</Button>
        </div>
      </CardContent></Card>
      {preview && (
        <div className="space-y-3">
          <p className="text-slate-600">{preview.lines} {L('lines read', 'سطر اتقرا')}{preview.skipped ? ` · ${preview.skipped} ${L('skipped (no date / amount)', 'اتساب (من غير تاريخ / مبلغ)')}` : ''}{preview.already ? ` · ${preview.already} ${L('already matched before', 'متطابقين قبل كده')}` : ''}</p>
          <Section title={`${L('Matched', 'متطابق')} (${preview.matched.length})`} tone="border-emerald-200">
            {preview.matched.map((m) => (
              <label key={m.move.id} className="flex items-start gap-2 border-t py-1.5 first:border-0">
                <input type="checkbox" className="mt-1" checked={!skip.has(m.move.id)} onChange={(e) => setSkip((s) => { const n = new Set(s); if (e.target.checked) n.delete(m.move.id); else n.add(m.move.id); return n })} />
                <span className="flex-1">{m.line.date} · {signed(m.move.direction, m.move.amount)} · {m.line.description || m.line.reference}<span className="block text-[11px] text-slate-500">{L('system', 'السيستم')}: {m.move.date} · {kindName(m.move.kind ?? '', ar)} · {m.move.note}</span></span>
              </label>
            ))}
            {!!preview.matched.length && <Button size="sm" className="mt-2" disabled={confirm.isPending} onClick={() => confirm.mutate()}>{L('Confirm the ticked matches', 'أكّد المطابقات المعلّمة')}</Button>}
          </Section>
          <Section title={`${L('Only in the bank', 'في البنك بس')} (${preview.bankOnly.length})`} tone="border-amber-200" hint={L('Bank fees, interest or money not recorded in the system — record it (expense, top-up…) then compare again.', 'مصاريف بنكية أو فوايد أو فلوس مش متسجلة في السيستم — سجّلها (مصروف، شحن…) وقارن تاني.')}>
            {preview.bankOnly.map((l) => <p key={l.row} className="border-t py-1 first:border-0">{L('row', 'سطر')} {l.row} · {l.date} · {l.amount >= 0 ? '+' : '−'}{money(Math.abs(l.amount))} · {l.description || l.reference}</p>)}
          </Section>
          <Section title={`${L('Only in the system', 'في السيستم بس')} (${preview.systemOnly.length})`} tone="border-rose-200" hint={L('Not on the statement yet (not cleared) or recorded on the wrong account / method.', 'لسه مانزلتش في الكشف أو متسجلة على حساب / طريقة دفع غلط.')}>
            {preview.systemOnly.map((m) => <p key={m.id} className="border-t py-1 first:border-0">{m.date} · {signed(m.direction, m.amount)} · {kindName(m.kind ?? '', ar)} · {m.note}</p>)}
          </Section>
        </div>
      )}
    </div>
  )
}

function Section({ title, tone, hint, children }: { title: string; tone: string; hint?: string; children: React.ReactNode }) {
  return <Card className={tone}><CardContent className="pt-4"><p className="font-semibold">{title}</p>{hint && <p className="mb-1 text-xs text-slate-500">{hint}</p>}{children}</CardContent></Card>
}
