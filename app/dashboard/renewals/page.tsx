'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Loader2, RefreshCcw } from 'lucide-react'

type Status = 'PENDING' | 'YES' | 'NO'
interface StudentRow {
  requestId: string
  studentId: string
  name: string
  firstName: string
  registrationNumber: string
  guardian: { id: string; name: string; phone: string } | null
  status: Status
  reason: string | null
  reasonNote: string | null
  respondedVia: 'PARENT' | 'STAFF' | null
  respondedAt: string | null
  earlyDiscount: boolean
}
interface GroupRow { id: string; label: string; campus: string; course: string | null; level: string | null; counts: { yes: number; no: number; pending: number }; students: StudentRow[] }
interface Data { settings: { sessionsBefore: number }; churn: { since: string; total: number; reasons: Record<string, number> }; groups: GroupRow[] }

const REASONS: Record<string, string> = { PRICE: 'Price', TIME: 'Time / schedule', LEVEL: 'Level / content', TRAVEL: 'Travel / moving', OTHER: 'Other' }
const STATUS_STYLE: Record<Status, string> = {
  YES: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  NO: 'border-slate-200 bg-slate-100 text-slate-600',
  PENDING: 'border-amber-200 bg-amber-50 text-amber-700',
}
const wa = (phone: string, text: string) => `https://wa.me/${phone.replace(/\D/g, '').replace(/^0/, '20')}?text=${encodeURIComponent(text)}`

/** Who continues next month: parents' answers per group, WhatsApp reminders, churn reasons (phase A). */
export default function RenewalsPage() {
  const qc = useQueryClient()
  const { data: session } = useSession()
  const { data: perms } = useQuery({
    queryKey: ['my-permissions', session?.user?.role],
    queryFn: () => fetchApi<{ permissions: Record<string, string[]> }>('/api/me/permissions'),
    staleTime: 60_000,
    enabled: !!session?.user?.role,
  })
  const canUpdate = !!perms?.permissions?.renewals?.includes('update')
  const canSettings = !!perms?.permissions?.finance_settings?.includes('update')
  const { data, isLoading, error } = useQuery({ queryKey: ['renewals'], queryFn: () => fetchApi<Data>('/api/renewals') })
  const [answer, setAnswer] = useState<{ row: StudentRow; value: 'YES' | 'NO' } | null>(null)
  const [reason, setReason] = useState('PRICE')
  const [note, setNote] = useState('')
  const [before, setBefore] = useState<string>('')

  const save = useMutation({
    mutationFn: () => fetchApi(`/api/renewals/${answer!.row.requestId}`, { method: 'PATCH', body: JSON.stringify({ answer: answer!.value, reason: answer!.value === 'NO' ? reason : null, note: note.trim() || null }) }),
    onSuccess: () => { notify.success('Saved'); setAnswer(null); setNote(''); qc.invalidateQueries({ queryKey: ['renewals'] }) },
    onError: (e: Error) => notify.error(e.message || 'Could not save'),
  })
  const saveSettings = useMutation({
    mutationFn: () => fetchApi('/api/renewals/settings', { method: 'PUT', body: JSON.stringify({ sessionsBefore: Number(before) }) }),
    onSuccess: () => { notify.success('Saved'); qc.invalidateQueries({ queryKey: ['renewals'] }) },
    onError: (e: Error) => notify.error(e.message || 'Could not save'),
  })
  const logWhatsApp = (row: StudentRow) => {
    // Written to the student's contact log (fire and forget).
    fetchApi('/api/contact-logs', {
      method: 'POST',
      body: JSON.stringify({ studentId: row.studentId, guardianId: row.guardian?.id ?? null, channel: 'WHATSAPP', reason: 'RENEWAL', summary: 'Renewal reminder sent on WhatsApp.', auto: true }),
    }).catch(() => undefined)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900"><RefreshCcw className="h-5 w-5 text-indigo-600" /> Renewals</h1>
          <p className="text-sm text-slate-500">Parents are asked “continuing next month?” {data ? `${data.settings.sessionsBefore} session(s)` : ''} before the last session. Their answers appear here and in “Advance cycle”.</p>
        </div>
        {canSettings && data && (
          <div className="flex items-end gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Ask how many sessions before the end</Label>
              <Input className="h-8 w-24" type="number" min={0} max={20} placeholder={String(data.settings.sessionsBefore)} value={before} onChange={(e) => setBefore(e.target.value)} />
            </div>
            <Button size="sm" variant="outline" className="h-8" disabled={before === '' || saveSettings.isPending} onClick={() => saveSettings.mutate()}>Save</Button>
          </div>
        )}
      </div>

      {isLoading && <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>}
      {error && <p className="text-sm text-rose-600">{(error as Error).message}</p>}

      {data && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Why students stopped (last 90 days)</CardTitle>
            <CardDescription>{data.churn.total} answer(s) “not continuing”.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2 text-sm">
            {Object.keys(REASONS).map((k) => (
              <span key={k} className="rounded-lg border border-slate-200 px-3 py-1.5">{REASONS[k]}: <strong>{data.churn.reasons[k] ?? 0}</strong></span>
            ))}
          </CardContent>
        </Card>
      )}

      {data && data.groups.length === 0 && <p className="text-sm text-slate-500">No group is close to its last session yet.</p>}
      {data?.groups.map((g) => (
        <Card key={g.id}>
          <CardHeader className="pb-2">
            <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
              <Link href={`/dashboard/groups?group=${g.id}`} className="hover:underline">{g.label}</Link>
              <span className="font-normal text-slate-500">{g.course} · {g.level} · {g.campus}</span>
              <span className="ml-auto flex gap-1.5 text-xs font-normal">
                <span className={`rounded-full border px-2 py-0.5 ${STATUS_STYLE.YES}`}>{g.counts.yes} continuing</span>
                <span className={`rounded-full border px-2 py-0.5 ${STATUS_STYLE.NO}`}>{g.counts.no} not</span>
                <span className={`rounded-full border px-2 py-0.5 ${STATUS_STYLE.PENDING}`}>{g.counts.pending} no answer</span>
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            {g.students.map((s) => (
              <div key={s.requestId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 px-3 py-1.5">
                <span>
                  <Link href={`/dashboard/students/${s.studentId}`} className="font-medium text-slate-800 hover:underline">{s.name}</Link>
                  <span className={`ml-2 rounded-full border px-2 py-0.5 text-[11px] ${STATUS_STYLE[s.status]}`}>
                    {s.status === 'YES' ? 'Continuing' : s.status === 'NO' ? `Not continuing${s.reason ? ` · ${REASONS[s.reason] ?? s.reason}` : ''}` : 'No answer yet'}
                  </span>
                  {s.respondedVia && <span className="ml-1 text-[11px] text-slate-400">({s.respondedVia === 'PARENT' ? 'parent, portal' : 'staff'})</span>}
                  {s.earlyDiscount && <span className="ml-1 text-[11px] text-emerald-700">· early discount</span>}
                  {s.reasonNote && <span className="block text-xs text-slate-500">{s.reasonNote}</span>}
                </span>
                <span className="flex gap-1.5">
                  {s.guardian && s.status === 'PENDING' && (
                    <a href={wa(s.guardian.phone, `Hello ${s.guardian.name}, ${s.firstName}'s month in ${g.label} at TechNova ends soon. Is ${s.firstName} continuing next month? You can also answer in the parent portal.`)} target="_blank" rel="noreferrer" onClick={() => logWhatsApp(s)}>
                      <Button size="sm" variant="outline" className="h-7 text-xs">WhatsApp</Button>
                    </a>
                  )}
                  {canUpdate && (
                    <>
                      <Button size="sm" variant="outline" className="h-7 text-xs text-emerald-700" onClick={() => setAnswer({ row: s, value: 'YES' })}>Continuing</Button>
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setAnswer({ row: s, value: 'NO' })}>Not continuing</Button>
                    </>
                  )}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      ))}

      <Dialog open={!!answer} onOpenChange={(o) => { if (!o) setAnswer(null) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{answer?.value === 'YES' ? 'Continuing next month' : 'Not continuing'}</DialogTitle>
            <DialogDescription>{answer?.row.name} — the parent&apos;s answer (by phone or in person).</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            {answer?.value === 'NO' && (
              <div className="space-y-1">
                <Label>Why?</Label>
                <Select value={reason} onValueChange={setReason}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.keys(REASONS).map((k) => <SelectItem key={k} value={k}>{REASONS[k]}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1">
              <Label>Note (optional)</Label>
              <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setAnswer(null)}>Cancel</Button>
              <Button disabled={save.isPending} onClick={() => save.mutate()}>Save</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
