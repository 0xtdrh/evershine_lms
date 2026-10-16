'use client'

/**
 * R1: session reports for staff — every report (draft / sent), what is not complete (homework not graded, quiz answers
 * to review, sessions without attendance) and the settings. Secretaries read only; instructors see their groups.
 */

import { useUrlTab } from '@/hooks/use-url-tab'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { checkPermission } from '@/lib/rbac'
import { L, useI18n } from '@/lib/i18n/client'
import { AccessDenied } from '@/components/AccessDenied'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { attendanceLabel } from '@/components/session-reports/SessionReportPanel'
import { AlertTriangle, ChevronDown, ExternalLink, FileText, Loader2, Plus, Star, Trash2 } from 'lucide-react'

interface Missing { key: 'HOMEWORK_UNGRADED' | 'QUIZ_REVIEW'; count: number }
interface Row { id: string; groupId: string; date: string; sessionNumber: number | null; status: string; sendAt: string | null; sentAt: string | null; group: string; course: string; level: string; campus: string; teacher: string; extras: number; missing: Missing[] }
interface ListData { reports: Row[]; noAttendance: { groupId: string; group: string; date: string; sessionNumber: number | null }[] }
interface Phrase { id: string; en: string; ar: string }
interface Settings { enabled: boolean; mode: 'AUTO' | 'MANUAL'; hours: number; phrases: Phrase[] }
interface SessionData { students: { id: string; name: string; attendance: string | null; star: boolean; phrases: string[]; comment: string }[] }

const DAY = 86_400_000
const ymd = (d: Date) => d.toISOString().slice(0, 10)
const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
const missingText = (m: Missing) => m.key === 'HOMEWORK_UNGRADED' ? L(`${m.count} homework not graded`, `${m.count} واجب ماتصححش`) : L(`${m.count} quiz answers to review`, `${m.count} إجابة كويز للمراجعة`)

function Students({ row }: { row: Row }) {
  const { data, isLoading } = useQuery({ queryKey: ['session-report', row.groupId, row.date], queryFn: () => fetchApi<SessionData>(`/api/session-reports?groupId=${row.groupId}&date=${row.date}`) })
  if (isLoading) return <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
  return (
    <div className="mt-2 grid gap-1 sm:grid-cols-2">
      {(data?.students ?? []).map((s) => (
        <a key={s.id} href={`/reports/session/${row.id}?student=${s.id}`} target="_blank" rel="noopener noreferrer" className="flex items-center justify-between gap-2 rounded border border-slate-100 px-2 py-1 text-xs hover:bg-slate-50">
          <span>{s.star && <Star className="me-1 inline h-3 w-3 text-amber-500" fill="currentColor" />}{s.name} <span className="text-slate-400">· {attendanceLabel(s.attendance)}</span></span>
          <ExternalLink className="h-3 w-3 text-indigo-600" />
        </a>
      ))}
    </div>
  )
}

function SettingsCard() {
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['session-report-settings'], queryFn: () => fetchApi<Settings>('/api/session-reports/settings') })
  const [s, setS] = useState<Settings | null>(null)
  useEffect(() => { if (data) setS(data) }, [data])
  const save = useMutation({
    mutationFn: () => fetchApi('/api/session-reports/settings', { method: 'PUT', body: JSON.stringify(s) }),
    onSuccess: () => { notify.success(L('Saved', 'اتحفظ')); qc.invalidateQueries({ queryKey: ['session-report-settings'] }) },
    onError: (e: Error) => notify.error(e.message),
  })
  if (!s) return <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
  const setPhrase = (i: number, p: Partial<Phrase>) => setS({ ...s, phrases: s.phrases.map((x, j) => (j === i ? { ...x, ...p } : x)) })
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">{L('Settings', 'الإعدادات')}</CardTitle></CardHeader>
      <CardContent className="space-y-4 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" checked={s.enabled} onChange={(e) => setS({ ...s, enabled: e.target.checked })} /> <span className="font-medium">{L('Session reports are on', 'تقارير الحصص شغالة')}</span></label>
        <div className="flex flex-wrap items-center gap-2">
          <span>{L('Sending', 'الإرسال')}</span>
          <Select value={s.mode} onValueChange={(v) => setS({ ...s, mode: v as Settings['mode'] })}>
            <SelectTrigger className="h-9 w-64"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="AUTO">{L('By itself, after the session', 'لوحده، بعد الحصة')}</SelectItem>
              <SelectItem value="MANUAL">{L('Only when the instructor presses Send', 'بس لما المدرب يضغط ابعت')}</SelectItem>
            </SelectContent>
          </Select>
          {s.mode === 'AUTO' && <><Input type="number" min={0} max={72} className="h-9 w-20" value={s.hours} onChange={(e) => setS({ ...s, hours: Math.max(0, Number(e.target.value) || 0) })} /> <span>{L('hours after the session ends (the instructor always gets at least 30 minutes)', 'ساعة بعد نهاية الحصة (المدرب دايمًا ليه 30 دقيقة على الأقل)')}</span></>}
        </div>
        <div className="space-y-2">
          <p className="font-medium">{L('Ready phrases for instructors', 'الجمل الجاهزة للمدربين')}</p>
          {s.phrases.map((p, i) => (
            <div key={p.id} className="flex flex-wrap items-center gap-2">
              <Input className="h-8 w-64" value={p.en} maxLength={80} placeholder={L('English', 'إنجليزي')} onChange={(e) => setPhrase(i, { en: e.target.value })} />
              <Input className="h-8 w-64" dir="rtl" value={p.ar} maxLength={80} placeholder="عربي" onChange={(e) => setPhrase(i, { ar: e.target.value })} />
              <Button type="button" size="sm" variant="ghost" onClick={() => setS({ ...s, phrases: s.phrases.filter((_, j) => j !== i) })}><Trash2 className="h-4 w-4 text-rose-500" /></Button>
            </div>
          ))}
          <Button type="button" size="sm" variant="outline" className="gap-1" onClick={() => setS({ ...s, phrases: [...s.phrases, { id: `p${Date.now().toString(36)}`, en: '', ar: '' }] })}><Plus className="h-4 w-4" /> {L('Phrase', 'جملة')}</Button>
        </div>
        <Button disabled={save.isPending || s.phrases.some((p) => !p.en.trim())} onClick={() => save.mutate()}>{save.isPending && <Loader2 className="me-2 h-4 w-4 animate-spin" />}{L('Save settings', 'احفظ الإعدادات')}</Button>
      </CardContent>
    </Card>
  )
}

export default function SessionReportsPage() {
  const [urlTab, setUrlTab] = useUrlTab()
  const { data: session } = useSession()
  const { dir } = useI18n()
  const role = session?.user?.role ?? ''
  const allowed = !!role && checkPermission(role, 'session_reports', 'read')
  const canSettings = !!role && checkPermission(role, 'session_reports', 'approve')
  const [from, setFrom] = useState(ymd(new Date(Date.now() - 14 * DAY)))
  const [to, setTo] = useState(ymd(new Date()))
  const [status, setStatus] = useState('ALL')
  const [open, setOpen] = useState<string | null>(null)
  const qs = new URLSearchParams({ from, to, ...(status !== 'ALL' ? { status } : {}) }).toString()
  const { data, isLoading } = useQuery({ queryKey: ['session-reports', qs], queryFn: () => fetchApi<ListData>(`/api/session-reports?${qs}`), enabled: allowed })
  if (!role) return null
  if (!allowed) return <AccessDenied title={L('Session reports', 'تقارير الحصص')} message={L("You don't have access to session reports.", 'مش عندك صلاحية لتقارير الحصص.')} />
  const incomplete = (data?.reports ?? []).filter((r) => r.missing.length)
  const notDone = incomplete.length + (data?.noAttendance.length ?? 0)

  return (
    <div className="space-y-4" dir={dir}>
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900"><FileText className="h-7 w-7 text-indigo-600" /> {L('Session reports', 'تقارير الحصص')}</h1>
        <p className="mt-1 text-sm text-slate-500">{L('A report for every student after each session: what was done, attendance, homework, quiz and the instructor note. It is made when attendance is saved.', 'تقرير لكل طالب بعد كل حصة: عملنا إيه، والحضور، والواجب، والكويز، وكلمة المدرب. بيتعمل لما الحضور يتسجل.')}</p>
      </div>
      <Tabs value={urlTab ?? 'list'} onValueChange={setUrlTab}>
        <TabsList>
          <TabsTrigger value="list">{L('Reports', 'التقارير')}</TabsTrigger>
          <TabsTrigger value="missing">{L('Not complete', 'ناقصة')}{notDone ? ` (${notDone})` : ''}</TabsTrigger>
          {canSettings && <TabsTrigger value="settings">{L('Settings', 'الإعدادات')}</TabsTrigger>}
        </TabsList>

        <TabsContent value="list" className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Input type="date" className="h-9 w-40" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} />
            <Input type="date" className="h-9 w-40" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} />
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="h-9 w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">{L('All', 'الكل')}</SelectItem>
                <SelectItem value="DRAFT">{L('Not sent yet', 'لسه ماتبعتش')}</SelectItem>
                <SelectItem value="SENT">{L('Sent', 'اتبعت')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {isLoading ? <Loader2 className="h-5 w-5 animate-spin text-slate-400" /> : !data?.reports.length ? <p className="text-sm text-slate-500">{L('No session reports in this period. Make sure they are switched on in Settings.', 'مفيش تقارير حصص في الفترة دي. اتأكد إنها شغالة من الإعدادات.')}</p> : data.reports.map((r) => (
            <Card key={r.id}>
              <CardContent className="pt-3">
                <button type="button" className="flex w-full flex-wrap items-center justify-between gap-2 text-start" onClick={() => setOpen(open === r.id ? null : r.id)}>
                  <div>
                    <p className="font-medium text-slate-800">{r.group} <span className="text-xs font-normal text-slate-400">· {r.course} · {r.level} · {r.campus}</span></p>
                    <p className="text-xs text-slate-500">{new Date(`${r.date}T00:00:00Z`).toLocaleDateString('en-GB')}{r.sessionNumber ? ` · ${L('session', 'حصة')} ${r.sessionNumber}` : ''}{r.teacher ? ` · ${r.teacher}` : ''}</p>
                  </div>
                  <span className="flex flex-wrap items-center gap-2 text-xs">
                    {r.missing.map((m) => <span key={m.key} className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-amber-700">{missingText(m)}</span>)}
                    {r.status === 'SENT'
                      ? <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-emerald-700">{L('Sent', 'اتبعت')} {r.sentAt ? when(r.sentAt) : ''}</span>
                      : <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-sky-700">{r.sendAt ? `${L('Goes out', 'هيتبعت')} ${when(r.sendAt)}` : L('Waits for the instructor', 'مستني المدرب')}</span>}
                    <ChevronDown className={`h-4 w-4 text-slate-400 transition ${open === r.id ? 'rotate-180' : ''}`} />
                  </span>
                </button>
                {open === r.id && <Students row={r} />}
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="missing" className="space-y-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className="h-4 w-4 text-amber-500" /> {L('Sessions without attendance (last 7 days)', 'حصص من غير حضور (آخر 7 أيام)')}</CardTitle>
              <CardDescription>{L('No report can be made until the attendance is saved.', 'مفيش تقرير هيتعمل غير لما الحضور يتسجل.')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              {!data?.noAttendance.length ? <p className="text-slate-500">{L('None.', 'مفيش.')}</p> : data.noAttendance.map((m) => (
                <p key={`${m.groupId}-${m.date}`}>{m.group} · {new Date(`${m.date}T00:00:00Z`).toLocaleDateString('en-GB')}{m.sessionNumber ? ` · ${L('session', 'حصة')} ${m.sessionNumber}` : ''}</p>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">{L('Reports with something missing', 'تقارير فيها حاجة ناقصة')}</CardTitle></CardHeader>
            <CardContent className="space-y-1 text-sm">
              {!incomplete.length ? <p className="text-slate-500">{L('None.', 'مفيش.')}</p> : incomplete.map((r) => (
                <div key={r.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span>{r.group} · {new Date(`${r.date}T00:00:00Z`).toLocaleDateString('en-GB')}{r.teacher ? ` · ${r.teacher}` : ''}</span>
                  <span className="flex flex-wrap gap-1 text-xs">{r.missing.map((m) => (
                    <Link key={m.key} href={m.key === 'HOMEWORK_UNGRADED' ? '/dashboard/assignments' : '/dashboard/quizzes'} className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-amber-700 hover:underline">{missingText(m)}</Link>
                  ))}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        {canSettings && <TabsContent value="settings"><SettingsCard /></TabsContent>}
      </Tabs>
    </div>
  )
}
