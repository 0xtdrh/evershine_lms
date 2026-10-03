'use client'

import { useState } from 'react'
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
import { PhoneCall, Plus, Check } from 'lucide-react'

interface ContactRow {
  id: string
  channel: string
  direction: 'OUT' | 'IN'
  reason: string
  summary: string
  followUpAt: string | null
  followUpDoneAt: string | null
  auto: boolean
  createdAt: string
  guardian: string | null
  by: string | null
}
interface ContactsData { guardians: { id: string; name: string; phone: string }[]; logs: ContactRow[] }

export const CHANNEL_LABEL: Record<string, string> = { CALL: '📞 Call', WHATSAPP: '💬 WhatsApp', MEETING: '🤝 Meeting', VISIT: '🏫 Visit', SYSTEM: '🤖 System' }
export const REASON_LABEL: Record<string, string> = { PAYMENT: 'Payment', ABSENCE: 'Absence', BEHAVIOUR: 'Behaviour', LEVEL: 'Level', RENEWAL: 'Renewal', COMPLAINT: 'Complaint', OTHER: 'Other' }

/** Calls, WhatsApp, meetings and visits with the student's parents, with follow-up dates (phase A). */
export function StudentContactLogCard({ studentId }: { studentId: string }) {
  const { data: session, status } = useSession()
  const qc = useQueryClient()
  const { data: perms } = useQuery({
    queryKey: ['my-permissions', session?.user?.role],
    queryFn: () => fetchApi<{ permissions: Record<string, string[]> }>('/api/me/permissions'),
    staleTime: 60_000,
    enabled: status === 'authenticated',
  })
  const canRead = !!perms?.permissions?.contact_logs?.includes('read')
  const canCreate = !!perms?.permissions?.contact_logs?.includes('create')
  const canUpdate = !!perms?.permissions?.contact_logs?.includes('update')
  const { data } = useQuery({
    queryKey: ['student-contacts', studentId],
    queryFn: () => fetchApi<ContactsData>(`/api/students/${studentId}/contacts`),
    enabled: canRead,
  })
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ guardianId: '', channel: 'CALL', direction: 'OUT', reason: 'PAYMENT', summary: '', followUpAt: '' })
  const refresh = () => { qc.invalidateQueries({ queryKey: ['student-contacts', studentId] }); qc.invalidateQueries({ queryKey: ['follow-ups'] }) }
  const add = useMutation({
    mutationFn: () =>
      fetchApi('/api/contact-logs', {
        method: 'POST',
        body: JSON.stringify({
          studentId,
          guardianId: form.guardianId || null,
          channel: form.channel,
          direction: form.direction,
          reason: form.reason,
          summary: form.summary,
          followUpAt: form.followUpAt ? new Date(form.followUpAt).toISOString() : null,
        }),
      }),
    onSuccess: () => { notify.success('Contact logged'); setOpen(false); setForm({ ...form, summary: '', followUpAt: '' }); refresh() },
    onError: (e: Error) => notify.error(e.message || 'Could not save'),
  })
  const done = useMutation({
    mutationFn: (id: string) => fetchApi(`/api/contact-logs/${id}`, { method: 'PATCH', body: JSON.stringify({ followUpDone: true }) }),
    onSuccess: () => { notify.success('Follow-up done'); refresh() },
  })
  if (!canRead) return null

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-sm"><PhoneCall className="h-4 w-4" /> Contact with parents</CardTitle>
          {canCreate && <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => setOpen(true)}><Plus className="h-3.5 w-3.5" /> Log contact</Button>}
        </div>
        <CardDescription>Calls, WhatsApp, meetings and visits, plus messages the system sent.</CardDescription>
      </CardHeader>
      <CardContent className="max-h-80 space-y-2 overflow-y-auto text-sm">
        {(data?.logs ?? []).length === 0 && <p className="text-slate-500">Nothing logged yet.</p>}
        {(data?.logs ?? []).map((r) => (
          <div key={r.id} className={`rounded-lg border px-3 py-2 ${r.auto ? 'border-slate-100 bg-slate-50' : 'border-slate-200'}`}>
            <div className="flex flex-wrap items-center justify-between gap-1 text-xs text-slate-500">
              <span>{CHANNEL_LABEL[r.channel] ?? r.channel} · {r.direction === 'IN' ? 'they contacted us' : 'we contacted them'} · {REASON_LABEL[r.reason] ?? r.reason}{r.guardian ? ` · ${r.guardian}` : ''}</span>
              <span>{new Date(r.createdAt).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}{r.by ? ` · ${r.by}` : ''}</span>
            </div>
            <p className="mt-0.5 whitespace-pre-wrap text-slate-800">{r.summary}</p>
            {r.followUpAt && (
              <p className={`mt-1 flex items-center gap-2 text-xs ${r.followUpDoneAt ? 'text-emerald-700' : new Date(r.followUpAt) < new Date() ? 'font-semibold text-rose-600' : 'text-amber-700'}`}>
                Follow-up {new Date(r.followUpAt).toLocaleDateString('en-GB')}{r.followUpDoneAt ? ' · done' : ''}
                {!r.followUpDoneAt && canUpdate && (
                  <button type="button" className="inline-flex items-center gap-0.5 underline" onClick={() => done.mutate(r.id)}><Check className="h-3 w-3" /> Mark done</button>
                )}
              </p>
            )}
          </div>
        ))}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Log contact with a parent</DialogTitle>
            <DialogDescription>Write what was said, and set a follow-up date if you need to call again.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label>Type</Label>
                <Select value={form.channel} onValueChange={(v) => setForm({ ...form, channel: v })}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>{['CALL', 'WHATSAPP', 'MEETING', 'VISIT'].map((c) => <SelectItem key={c} value={c}>{CHANNEL_LABEL[c]}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Who started it</Label>
                <Select value={form.direction} onValueChange={(v) => setForm({ ...form, direction: v })}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="OUT">We contacted them</SelectItem><SelectItem value="IN">They contacted us</SelectItem></SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Reason</Label>
                <Select value={form.reason} onValueChange={(v) => setForm({ ...form, reason: v })}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.keys(REASON_LABEL).map((r) => <SelectItem key={r} value={r}>{REASON_LABEL[r]}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Parent</Label>
                <Select value={form.guardianId || 'none'} onValueChange={(v) => setForm({ ...form, guardianId: v === 'none' ? '' : v })}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">—</SelectItem>
                    {(data?.guardians ?? []).map((g) => <SelectItem key={g.id} value={g.id}>{g.name} ({g.phone})</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label>What was said</Label>
              <Textarea rows={3} value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>Follow-up date (optional)</Label>
              <Input type="date" value={form.followUpAt} onChange={(e) => setForm({ ...form, followUpAt: e.target.value })} />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button disabled={form.summary.trim().length < 2 || add.isPending} onClick={() => add.mutate()}>Save</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
