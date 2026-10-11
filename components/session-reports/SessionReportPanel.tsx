'use client'

/**
 * R1: the session report of the chosen group + date, inside the attendance screens (instructor / managers; hidden for
 * secretaries). Star, ready phrases and a comment per student, a note for the whole group, "Send now".
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { L, useI18n } from '@/lib/i18n/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { ExternalLink, FileText, Loader2, Send, Star } from 'lucide-react'

interface Phrase { id: string; en: string; ar: string }
interface Row { id: string; name: string; attendance: string | null; star: boolean; phrases: string[]; comment: string }
interface Data {
  enabled: boolean; mode: 'AUTO' | 'MANUAL'; hours: number; phrases: Phrase[]; canEdit: boolean
  report: { id: string; status: string; sendAt: string | null; sentAt: string | null; sessionNumber: number | null; groupNote: string | null } | null
  missing: { key: 'HOMEWORK_UNGRADED' | 'QUIZ_REVIEW'; count: number }[]
  students: Row[]
}

export const ATTENDANCE_AR: Record<string, string> = { PRESENT: 'حاضر', LATE: 'متأخر', ABSENT: 'غايب', EXCUSED: 'غياب بعذر' }
export const attendanceLabel = (s: string | null) => (s ? L(s.charAt(0) + s.slice(1).toLowerCase(), ATTENDANCE_AR[s] ?? s) : '—')
const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })

export function SessionReportPanel({ groupId, date }: { groupId: string; date: string }) {
  const { data: session } = useSession()
  const { locale } = useI18n()
  const qc = useQueryClient()
  const hidden = !session?.user?.role || session.user.role === 'SECRETARY'
  const key = ['session-report', groupId, date]
  const { data, isLoading } = useQuery({ queryKey: key, queryFn: () => fetchApi<Data>(`/api/session-reports?groupId=${groupId}&date=${date}`), enabled: !hidden && !!groupId && !!date, retry: false })
  const [rows, setRows] = useState<Row[]>([])
  const [note, setNote] = useState('')
  const [dirty, setDirty] = useState(false)
  useEffect(() => { if (data) { setRows(data.students); setNote(data.report?.groupNote ?? ''); setDirty(false) } }, [data])

  const save = useMutation({
    mutationFn: () => fetchApi(`/api/session-reports/${data!.report!.id}`, { method: 'PATCH', body: JSON.stringify({ groupNote: note, students: rows.map((r) => ({ studentId: r.id, star: r.star, phrases: r.phrases, comment: r.comment })) }) }),
    onSuccess: () => { notify.success(L('Saved', 'اتحفظ')); qc.invalidateQueries({ queryKey: key }) },
    onError: (e: Error) => notify.error(e.message),
  })
  const send = useMutation({
    mutationFn: async () => {
      if (dirty) await save.mutateAsync()
      return fetchApi(`/api/session-reports/${data!.report!.id}/send`, { method: 'POST' })
    },
    onSuccess: () => { notify.success(L('Report sent to the families', 'التقرير اتبعت لأولياء الأمور')); qc.invalidateQueries({ queryKey: key }) },
    onError: (e: Error) => notify.error(e.message),
  })

  if (hidden || !groupId) return null
  if (isLoading) return <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
  if (!data || !data.enabled) return null
  const r = data.report
  const edit = data.canEdit
  const set = (id: string, p: Partial<Row>) => { setRows((xs) => xs.map((x) => (x.id === id ? { ...x, ...p } : x))); setDirty(true) }
  const phraseText = (p: Phrase) => (locale === 'ar' && p.ar ? p.ar : p.en)

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base"><FileText className="h-5 w-5 text-indigo-600" /> {L('Session report', 'تقرير الحصة')}{r?.sessionNumber ? ` · ${L('session', 'حصة')} ${r.sessionNumber}` : ''}</CardTitle>
            <CardDescription>
              {!r ? L('Save the attendance first — the report is made from it.', 'سجّل الحضور الأول — التقرير بيتعمل منه.')
                : r.status === 'SENT' ? `${L('Sent', 'اتبعت')} ${r.sentAt ? when(r.sentAt) : ''} · ${L('it cannot be changed now.', 'مينفعش يتعدّل دلوقتي.')}`
                : r.sendAt ? `${L('Goes to the families by itself on', 'هيتبعت لأولياء الأمور لوحده يوم')} ${when(r.sendAt)}. ${L('Everything below is optional.', 'كل اللي تحت اختياري.')}`
                : L('Sent only when you press "Send now". Everything below is optional.', 'مش هيتبعت غير لما تضغط «ابعت دلوقتي». كل اللي تحت اختياري.')}
            </CardDescription>
          </div>
          {r && edit && (
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>{save.isPending && <Loader2 className="me-1 h-4 w-4 animate-spin" />}{L('Save', 'حفظ')}</Button>
              <Button size="sm" className="gap-1" disabled={send.isPending} onClick={() => confirm(L('Send the report to the families now?', 'تبعت التقرير لأولياء الأمور دلوقتي؟')) && send.mutate()}><Send className="h-4 w-4" /> {L('Send now', 'ابعت دلوقتي')}</Button>
            </div>
          )}
        </div>
        {r && data.missing.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            {data.missing.map((m) => (
              <Link key={m.key} href={m.key === 'HOMEWORK_UNGRADED' ? '/dashboard/assignments' : '/dashboard/quizzes'} className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-amber-700 hover:underline">
                {m.key === 'HOMEWORK_UNGRADED' ? L(`${m.count} homework of the last session not graded yet (shown as "grading in progress")`, `${m.count} واجب من الحصة اللي فاتت لسه ماتصححش (هيظهر «جاري التصحيح»)`) : L(`${m.count} quiz answers waiting for your review`, `${m.count} إجابة كويز مستنية مراجعتك`)}
              </Link>
            ))}
          </div>
        )}
      </CardHeader>
      {r && (
        <CardContent className="space-y-3">
          <label className="block space-y-1 text-sm">
            <span className="text-xs text-slate-500">{L('Note for the whole group (optional)', 'ملاحظة للجروب كله (اختياري)')}</span>
            <textarea className="min-h-[60px] w-full rounded-md border border-slate-200 bg-white p-2 text-sm" disabled={!edit} maxLength={1000} value={note} onChange={(e) => { setNote(e.target.value); setDirty(true) }}
              placeholder={L('e.g. Today we built a robot that follows a line', 'مثلًا: النهارده عملنا روبوت بيمشي على خط')} />
          </label>
          <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {rows.map((s) => (
              <div key={s.id} className="space-y-2 p-2 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <button type="button" disabled={!edit} title={L('Star of the session', 'نجم الحصة')} onClick={() => set(s.id, { star: !s.star })}
                      className={`rounded-full p-1 ${s.star ? 'text-amber-500' : 'text-slate-300 hover:text-amber-400'}`}><Star className="h-5 w-5" fill={s.star ? 'currentColor' : 'none'} /></button>
                    <span className="font-medium text-slate-800">{s.name}</span>
                    <span className="text-xs text-slate-400">{attendanceLabel(s.attendance)}</span>
                  </div>
                  <a href={`/reports/session/${r.id}?student=${s.id}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-indigo-700 hover:underline">{L('Preview', 'معاينة')} <ExternalLink className="h-3 w-3" /></a>
                </div>
                <div className="flex flex-wrap gap-1">
                  {data.phrases.map((p) => {
                    const on = s.phrases.includes(p.id)
                    return (
                      <button key={p.id} type="button" disabled={!edit} onClick={() => set(s.id, { phrases: on ? s.phrases.filter((x) => x !== p.id) : [...s.phrases, p.id] })}
                        className={`rounded-full border px-2 py-0.5 text-xs ${on ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'} ${!edit && !on ? 'hidden' : ''}`}>{phraseText(p)}</button>
                    )
                  })}
                </div>
                {(edit || s.comment) && <Input className="h-8 text-xs" disabled={!edit} maxLength={500} value={s.comment} onChange={(e) => set(s.id, { comment: e.target.value })} placeholder={L('Short comment for this student (optional)', 'تعليق قصير للطالب ده (اختياري)')} />}
              </div>
            ))}
          </div>
        </CardContent>
      )}
    </Card>
  )
}
