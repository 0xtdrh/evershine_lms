'use client'

/**
 * Phase D complaints & suggestions (docs/design-phase-d.md).
 * Students / parents: send a complaint, suggestion or thank-you and follow it.
 * Staff with complaints permissions: the queue, phone complaints, the monthly report, settings.
 */

import { useMyPermissions } from '@/hooks/use-my-permissions'
import { useUrlTab } from '@/hooks/use-url-tab'
import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { AccessDenied } from '@/components/AccessDenied'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ComplaintThread, KIND_LABEL, STATUS_LABEL, TOPIC_LABEL } from '@/components/complaints/ComplaintThread'
import { AlertOctagon, Loader2, MessageSquarePlus, Phone } from 'lucide-react'
import { L, useI18n } from '@/lib/i18n/client'

interface Row {
  id: string; number: string | null; kind: string; topic: string | null; status: string; source: string; text: string; sender: string
  student: string | null; group: string | null; assignedTo: string | null; overdue: boolean; escalated: boolean; satisfied: boolean | null; replies: number; createdAt: string
}
interface ListData { portal: boolean; complaints: Row[] }
interface Child { id: string; firstName: string; lastName: string }

const STATUS_CLS: Record<string, string> = {
  NEW: 'bg-amber-50 text-amber-700 border-amber-200',
  IN_PROGRESS: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  RESOLVED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  CLOSED: 'bg-slate-50 text-slate-500 border-slate-200',
}
const KINDS = ['COMPLAINT', 'SUGGESTION', 'PRAISE'] as const
const TOPICS = ['INSTRUCTOR', 'SCHEDULE', 'PAYMENT', 'PLACE', 'SESSION', 'OTHER'] as const

function RowList({ rows, onOpen, staff }: { rows: Row[]; onOpen: (id: string) => void; staff: boolean }) {
  if (!rows.length) return <p className="py-8 text-center text-sm text-slate-500">{L('Nothing here.', 'مفيش حاجة هنا.')}</p>
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <button key={r.id} type="button" onClick={() => onOpen(r.id)} className={`w-full rounded-lg border p-3 text-left text-sm transition hover:bg-slate-50 ${r.overdue ? 'border-rose-300' : 'border-slate-200'}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-slate-500">{r.number} · {KIND_LABEL[r.kind] ?? r.kind}{r.topic ? ` · ${TOPIC_LABEL[r.topic] ?? r.topic}` : ''} · {new Date(r.createdAt).toLocaleDateString(L('en-GB', 'ar-EG-u-nu-latn'))}</span>
            <span className="flex items-center gap-1.5">
              {staff && r.overdue && <span className="rounded-full bg-rose-600 px-2 py-0.5 text-[10px] font-bold text-white">{L('LATE', 'متأخرة')}</span>}
              {staff && r.escalated && <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-700">{L('escalated', 'متصعّدة')}</span>}
              <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${STATUS_CLS[r.status] ?? ''}`}>{STATUS_LABEL[r.status] ?? r.status}</span>
            </span>
          </div>
          {staff && <p className="mt-0.5 font-medium text-slate-800">{r.sender}{r.student ? ` · ${r.student}` : ''}{r.group ? ` · ${r.group}` : ''}</p>}
          <p className="line-clamp-2 text-slate-700">{r.text}</p>
          <p className="mt-0.5 text-[11px] text-slate-400">{r.replies} {L(r.replies === 1 ? 'reply' : 'replies', 'رد')}{staff ? ` · ${r.assignedTo ? `${L('responsible', 'المسؤول')}: ${r.assignedTo}` : L('nobody responsible yet', 'لسه مفيش مسؤول')}` : ''}</p>
        </button>
      ))}
    </div>
  )
}

function NewMessageForm({ portal, onDone }: { portal: boolean; onDone: () => void }) {
  const [kind, setKind] = useState<(typeof KINDS)[number]>('COMPLAINT')
  const [topic, setTopic] = useState<(typeof TOPICS)[number]>('OTHER')
  const [body, setBody] = useState('')
  const [studentId, setStudentId] = useState('')
  const [from, setFrom] = useState<'PARENT' | 'STUDENT'>('PARENT')
  const [search, setSearch] = useState('')
  const { data: children } = useQuery({ queryKey: ['guardian-children'], queryFn: () => fetchApi<Child[]>('/api/guardian-portal/children'), enabled: portal })
  const { data: found } = useQuery({
    queryKey: ['complaint-student-search', search],
    queryFn: () => fetchApi<Child[] | { items?: Child[] }>(`/api/students?search=${encodeURIComponent(search)}&limit=8`),
    enabled: !portal && search.trim().length >= 2,
  })
  const foundList: (Child & { registrationNumber?: string })[] = Array.isArray(found) ? found : (found as { items?: Child[] })?.items ?? []
  const send = useMutation({
    mutationFn: () => fetchApi('/api/complaints', { method: 'POST', body: JSON.stringify(portal ? { kind, topic, body, studentId: studentId || null } : { kind, topic, body, studentId, from }) }),
    onSuccess: () => { notify.success(portal ? L('Sent — we will reply soon', 'اتبعتت — هنرد عليك قريب') : L('Recorded', 'اتسجلت')); setBody(''); onDone() },
    onError: (e: Error) => notify.error(e.message),
  })
  const kids = children ?? []
  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap gap-2">
        {KINDS.map((k) => (
          <button key={k} type="button" onClick={() => setKind(k)} className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${kind === k ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-600'}`}>
            {k === 'COMPLAINT' ? `😟 ${L('Complaint', 'شكوى')}` : k === 'SUGGESTION' ? `💡 ${L('Suggestion', 'اقتراح')}` : `🙏 ${L('Thank you', 'شكر')}`}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Select value={topic} onValueChange={(v) => setTopic(v as (typeof TOPICS)[number])}>
          <SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger>
          <SelectContent>{TOPICS.map((t) => <SelectItem key={t} value={t}>{TOPIC_LABEL[t]}</SelectItem>)}</SelectContent>
        </Select>
        {portal && kids.length > 1 && (
          <Select value={studentId} onValueChange={setStudentId}>
            <SelectTrigger className="h-9 w-48"><SelectValue placeholder={L('About which child?', 'بخصوص أنهي ابن؟')} /></SelectTrigger>
            <SelectContent>{kids.map((c) => <SelectItem key={c.id} value={c.id}>{c.firstName} {c.lastName}</SelectItem>)}</SelectContent>
          </Select>
        )}
        {!portal && (
          <Select value={from} onValueChange={(v) => setFrom(v as 'PARENT' | 'STUDENT')}>
            <SelectTrigger className="h-9 w-40"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="PARENT">{L('From the parent', 'من ولي الأمر')}</SelectItem><SelectItem value="STUDENT">{L('From the student', 'من الطالب')}</SelectItem></SelectContent>
          </Select>
        )}
      </div>
      {!portal && (
        <div className="space-y-1">
          <Input className="h-9" placeholder={L('Search the student (name or registration no.)', 'دوّر على الطالب (الاسم أو رقم التسجيل)')} value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="flex flex-wrap gap-1.5">
            {foundList.map((s) => (
              <button key={s.id} type="button" onClick={() => setStudentId(s.id)} className={`rounded-full border px-2.5 py-1 text-xs ${studentId === s.id ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-200'}`}>
                {s.firstName} {s.lastName}{s.registrationNumber ? ` · ${s.registrationNumber}` : ''}
              </button>
            ))}
          </div>
        </div>
      )}
      <textarea className="min-h-[100px] w-full rounded-md border border-slate-200 bg-white p-2" maxLength={5000} placeholder={L('Write the details…', 'اكتب التفاصيل…')} value={body} onChange={(e) => setBody(e.target.value)} />
      <p className="text-xs text-slate-500">{portal ? L('Your name is shown with the message. We reply here and you get a notification.', 'اسمك بيظهر مع الرسالة. هنرد هنا وهيوصلك إشعار.') : L('Saved in the parent’s name as "recorded by phone", with an internal note that you recorded it.', 'بتتحفظ باسم ولي الأمر "اتسجلت بالتليفون"، مع ملاحظة داخلية إنك اللي سجلتها.')}</p>
      <Button className="gap-1.5" disabled={body.trim().length < 3 || (!portal && !studentId) || send.isPending} onClick={() => send.mutate()}>
        {send.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : portal ? <MessageSquarePlus className="h-4 w-4" /> : <Phone className="h-4 w-4" />} {portal ? L('Send', 'ابعت') : L('Record', 'سجّل')}
      </Button>
    </div>
  )
}

function ReportTab({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient()
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7))
  const { data } = useQuery({
    queryKey: ['complaints-report', month],
    queryFn: () => fetchApi<{ report: { total: number; byKind: Record<string, number>; byTopic: Record<string, number>; byBranch: Record<string, number>; byStatus: Record<string, number>; escalated: number; avgHoursToResolve: number | null; solvedRate: number | null; avgHandlingRating: number | null }; settings: { replyHours: number; autoCloseDays: number } }>(`/api/complaints/report?month=${month}`),
  })
  const [s, setS] = useState({ replyHours: 24, autoCloseDays: 3 })
  useEffect(() => { if (data) setS(data.settings) }, [data])
  const save = useMutation({
    mutationFn: () => fetchApi('/api/complaints/report', { method: 'PUT', body: JSON.stringify(s) }),
    onSuccess: () => { notify.success(L('Saved', 'اتحفظ')); qc.invalidateQueries({ queryKey: ['complaints-report'] }) },
    onError: (e: Error) => notify.error(e.message),
  })
  const r = data?.report
  const block = (title: string, m?: Record<string, number>, labels?: Record<string, string>) => (
    <Card><CardHeader className="pb-1"><CardTitle className="text-sm">{title}</CardTitle></CardHeader><CardContent className="space-y-1 text-sm">
      {m && Object.keys(m).length ? Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k, v]) => <div key={k} className="flex justify-between"><span>{labels?.[k] ?? k}</span><span className="font-semibold">{v}</span></div>) : <p className="text-slate-400">—</p>}
    </CardContent></Card>
  )
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2"><Input type="month" className="h-9 w-44" value={month} onChange={(e) => setMonth(e.target.value)} /></div>
      {!r ? <Loader2 className="h-5 w-5 animate-spin text-slate-400" /> : (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            {[[L('Messages', 'الرسائل'), r.total], [L('Escalated', 'اتصعّدت'), r.escalated], [L('Avg. hours to solve', 'متوسط ساعات الحل'), r.avgHoursToResolve ?? '—'], [L('Said "solved"', 'قالوا "اتحلّت"'), r.solvedRate == null ? '—' : `${r.solvedRate}%`]].map(([l, v]) => (
              <Card key={l as string}><CardContent className="pt-4"><p className="text-xs text-slate-500">{l}</p><p className="text-2xl font-bold">{v}</p></CardContent></Card>
            ))}
          </div>
          <div className="grid gap-3 md:grid-cols-4">
            {block(L('By topic', 'حسب الموضوع'), r.byTopic, TOPIC_LABEL)}
            {block(L('By branch', 'حسب الفرع'), r.byBranch)}
            {block(L('By type', 'حسب النوع'), r.byKind, KIND_LABEL)}
            {block(L('By stage', 'حسب المرحلة'), r.byStatus, STATUS_LABEL)}
          </div>
        </>
      )}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">{L('Settings', 'الإعدادات')}</CardTitle><CardDescription>{L('Unanswered complaints go to the branch manager after the reply time. Solved ones close by themselves if the sender does not answer.', 'الشكوى اللي مفيش رد عليها بتروح لمدير الفرع بعد وقت الرد. واللي اتحلّت بتتقفل لوحدها لو صاحبها مردّش.')}</CardDescription></CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-1.5">{L('Reply within', 'الرد خلال')} <Input type="number" min={1} max={240} className="h-8 w-20" value={s.replyHours} disabled={!canEdit} onChange={(e) => setS({ ...s, replyHours: Number(e.target.value) || 24 })} /> {L('hours', 'ساعة')}</label>
          <label className="flex items-center gap-1.5">{L('Close solved ones after', 'اقفل اللي اتحلّت بعد')} <Input type="number" min={1} max={60} className="h-8 w-20" value={s.autoCloseDays} disabled={!canEdit} onChange={(e) => setS({ ...s, autoCloseDays: Number(e.target.value) || 3 })} /> {L('days', 'يوم')}</label>
          {canEdit && <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>{L('Save', 'حفظ')}</Button>}
        </CardContent>
      </Card>
    </div>
  )
}

export default function ComplaintsPage() {
  const [urlTab, setUrlTab] = useUrlTab()
  const { data: session } = useSession()
  useI18n() // re-render on a language switch
  const role = session?.user?.role ?? ''
  const { can, ready: permsReady } = useMyPermissions() // effective permissions (Permissions page + overrides)
  const portal = ['STUDENT', 'PARENT', 'GUARDIAN'].includes(role)
  const staffRead = can('complaints', 'read')
  const [open, setOpen] = useState<string | null>(null)
  const [status, setStatus] = useState('OPEN')
  const [kind, setKind] = useState('all')
  const [extra, setExtra] = useState<'all' | 'mine' | 'overdue'>('all')
  const [showForm, setShowForm] = useState(false)
  const qc = useQueryClient()
  const qs = portal ? '' : `?status=${status}${kind !== 'all' ? `&kind=${kind}` : ''}${extra === 'mine' ? '&mine=1' : extra === 'overdue' ? '&overdue=1' : ''}`
  const { data, isLoading } = useQuery({ queryKey: ['complaints', qs], queryFn: () => fetchApi<ListData>(`/api/complaints${qs}`), enabled: portal || staffRead })
  if (!role) return null
  if (!portal && !staffRead) return <AccessDenied title={L('Complaints', 'الشكاوى')} message={L("You don't have access to complaints.", 'مالكش صلاحية على الشكاوى.')} />
  const rows = data?.complaints ?? []
  const refresh = () => qc.invalidateQueries({ queryKey: ['complaints'] })

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900"><AlertOctagon className="h-7 w-7 text-rose-600" /> {L('Complaints & suggestions', 'الشكاوى والاقتراحات')}</h1>
          <p className="mt-1 text-sm text-slate-500">{portal ? L('Tell us what went wrong, what we can do better, or who did a great job. We reply here.', 'قولنا إيه اللي مش عاجبك، أو نعمل إيه أحسن، أو مين عمل شغل حلو. هنرد عليك هنا.') : L('Every message has a responsible person and a reply deadline; late ones go to the branch manager.', 'كل رسالة ليها مسؤول وميعاد رد، والمتأخرة بتروح لمدير الفرع.')}</p>
        </div>
        {portal && <Button className="gap-1.5" onClick={() => setShowForm(!showForm)}><MessageSquarePlus className="h-4 w-4" /> {L('New message', 'رسالة جديدة')}</Button>}
      </div>

      {portal ? (
        <>
          {showForm && <Card><CardContent className="pt-5"><NewMessageForm portal onDone={() => { setShowForm(false); refresh() }} /></CardContent></Card>}
          {isLoading ? <Loader2 className="h-5 w-5 animate-spin text-slate-400" /> : <RowList rows={rows} onOpen={setOpen} staff={false} />}
        </>
      ) : (
        <Tabs value={urlTab ?? 'queue'} onValueChange={setUrlTab}>
          <TabsList>
            <TabsTrigger value="queue">{L('Queue', 'الطابور')}</TabsTrigger>
            {can('complaints', 'create') && <TabsTrigger value="phone">{L('Record by phone', 'تسجيل من التليفون')}</TabsTrigger>}
            {can('complaints', 'export') && <TabsTrigger value="report">{L('Report', 'التقرير')}</TabsTrigger>}
          </TabsList>
          <TabsContent value="queue" className="mt-4 space-y-3">
            <div className="flex flex-wrap gap-2">
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="h-9 w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="OPEN">{L('Open', 'المفتوحة')}</SelectItem>
                  {['NEW', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'].map((s) => <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>)}
                  <SelectItem value="ALL">{L('All', 'الكل')}</SelectItem>
                </SelectContent>
              </Select>
              <Select value={kind} onValueChange={setKind}>
                <SelectTrigger className="h-9 w-40"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="all">{L('All types', 'كل الأنواع')}</SelectItem>{KINDS.map((k) => <SelectItem key={k} value={k}>{KIND_LABEL[k]}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={extra} onValueChange={(v) => setExtra(v as 'all' | 'mine' | 'overdue')}>
                <SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="all">{L('Everyone’s', 'الكل')}</SelectItem><SelectItem value="mine">{L('Responsible: me', 'المسؤول: أنا')}</SelectItem><SelectItem value="overdue">{L('Late (no reply)', 'متأخرة (مفيش رد)')}</SelectItem></SelectContent>
              </Select>
            </div>
            {isLoading ? <Loader2 className="h-5 w-5 animate-spin text-slate-400" /> : <RowList rows={rows} onOpen={setOpen} staff />}
          </TabsContent>
          <TabsContent value="phone" className="mt-4"><Card><CardContent className="pt-5"><NewMessageForm portal={false} onDone={refresh} /></CardContent></Card></TabsContent>
          <TabsContent value="report" className="mt-4"><ReportTab canEdit={can('complaints', 'export')} /></TabsContent>
        </Tabs>
      )}

      <Dialog open={!!open} onOpenChange={(o) => { if (!o) setOpen(null) }}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader><DialogTitle>{portal ? L('Your message', 'رسالتك') : L('Complaint', 'الشكوى')}</DialogTitle></DialogHeader>
          {open && <ComplaintThread id={open} staff={!portal} />}
        </DialogContent>
      </Dialog>
    </div>
  )
}
