'use client'

/** Agreements centre: write the agreements, publish versions, see who accepted, remind, export. */

import { useState } from 'react'
import { useSession } from 'next-auth/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { checkPermission } from '@/lib/rbac'
import { AccessDenied } from '@/components/AccessDenied'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Bell, Download, FileSignature, Loader2, Plus, Users } from 'lucide-react'

interface Agreement {
  id: string; key: string; titleEn: string; titleAr: string; bodyEn: string; bodyAr: string; audience: 'PARENT' | 'STUDENT' | 'STAFF'
  mandatory: boolean; isActive: boolean; version: number; graceDays: number; sortOrder: number; acceptedCurrent: number; publishedAt: string
}
interface Status { agreement: { titleEn: string; version: number }; accepted: number; pending: number; rows: { userId: string; name: string; role: string; contact: string; acceptedAt: string | null; device: string | null }[] }

const AUD: Record<string, string> = { PARENT: 'Parents', STUDENT: 'Students', STAFF: 'Staff' }
const blank = { key: '', audience: 'PARENT' as const, titleEn: '', titleAr: '', bodyEn: '', bodyAr: '', mandatory: true, isActive: false, graceDays: 0, sortOrder: 10 }

function Editor({ a, onClose }: { a: Agreement | null; onClose: () => void }) {
  const qc = useQueryClient()
  const [f, setF] = useState(a ? { key: a.key, audience: a.audience, titleEn: a.titleEn, titleAr: a.titleAr, bodyEn: a.bodyEn, bodyAr: a.bodyAr, mandatory: a.mandatory, isActive: a.isActive, graceDays: a.graceDays, sortOrder: a.sortOrder } : blank)
  const save = useMutation({
    mutationFn: () => a
      ? fetchApi(`/api/agreements/${a.id}`, { method: 'PATCH', body: JSON.stringify({ ...f, key: undefined }) })
      : fetchApi('/api/agreements', { method: 'POST', body: JSON.stringify(f) }),
    onSuccess: () => { notify.success('Saved'); qc.invalidateQueries({ queryKey: ['agreements'] }); onClose() },
    onError: (e: Error) => notify.error(e.message),
  })
  const textChanged = !!a && (f.titleEn !== a.titleEn || f.titleAr !== a.titleAr || f.bodyEn !== a.bodyEn || f.bodyAr !== a.bodyAr)
  return (
    <div className="space-y-3 text-sm">
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="space-y-1"><span className="text-xs text-slate-500">Key</span><Input value={f.key} disabled={!!a} onChange={(e) => setF({ ...f, key: e.target.value })} placeholder="e.g. parent-rules" /></label>
        <label className="space-y-1"><span className="text-xs text-slate-500">For</span>
          <Select value={f.audience} onValueChange={(v) => setF({ ...f, audience: v as typeof f.audience })} disabled={!!a}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{Object.entries(AUD).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
          </Select>
        </label>
        <label className="space-y-1"><span className="text-xs text-slate-500">Grace days after a new version</span><Input type="number" min={0} max={60} value={f.graceDays} onChange={(e) => setF({ ...f, graceDays: Number(e.target.value) || 0 })} /></label>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="space-y-1"><span className="text-xs text-slate-500">Title (English)</span><Input value={f.titleEn} onChange={(e) => setF({ ...f, titleEn: e.target.value })} /></label>
        <label className="space-y-1" dir="rtl"><span className="text-xs text-slate-500">العنوان (عربي)</span><Input value={f.titleAr} onChange={(e) => setF({ ...f, titleAr: e.target.value })} /></label>
        <label className="space-y-1"><span className="text-xs text-slate-500">Text (English)</span><textarea className="min-h-[220px] w-full rounded-md border border-slate-200 bg-white p-2" value={f.bodyEn} onChange={(e) => setF({ ...f, bodyEn: e.target.value })} /></label>
        <label className="space-y-1" dir="rtl"><span className="text-xs text-slate-500">النص (عربي)</span><textarea className="min-h-[220px] w-full rounded-md border border-slate-200 bg-white p-2" value={f.bodyAr} onChange={(e) => setF({ ...f, bodyAr: e.target.value })} /></label>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2"><input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /> Switched on (shown to users)</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={f.mandatory} onChange={(e) => setF({ ...f, mandatory: e.target.checked })} /> Mandatory (blocks the portal until accepted)</label>
      </div>
      {textChanged && <p className="rounded bg-amber-50 p-2 text-xs text-amber-800">You changed the text: saving publishes version {a!.version + 1} and everyone must accept again{f.graceDays ? ` (within ${f.graceDays} day(s))` : ''}.</p>}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save</Button>
      </div>
    </div>
  )
}

function StatusView({ id, canRemind }: { id: string; canRemind: boolean }) {
  const [show, setShow] = useState<'pending' | 'accepted'>('pending')
  const { data } = useQuery({ queryKey: ['agreement-status', id], queryFn: () => fetchApi<Status>(`/api/agreements/${id}`) })
  const remind = useMutation({
    mutationFn: () => fetchApi<{ reminded: number }>(`/api/agreements/${id}`, { method: 'POST', body: JSON.stringify({ action: 'remind' }) }),
    onSuccess: (r) => notify.success(`Reminder sent to ${r.reminded}`),
    onError: (e: Error) => notify.error(e.message),
  })
  if (!data) return <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
  const rows = data.rows.filter((r) => (show === 'pending' ? !r.acceptedAt : !!r.acceptedAt))
  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant={show === 'pending' ? 'default' : 'outline'} onClick={() => setShow('pending')}>Pending ({data.pending})</Button>
        <Button size="sm" variant={show === 'accepted' ? 'default' : 'outline'} onClick={() => setShow('accepted')}>Accepted ({data.accepted})</Button>
        {canRemind && data.pending > 0 && <Button size="sm" variant="outline" className="gap-1" onClick={() => remind.mutate()} disabled={remind.isPending}><Bell className="h-4 w-4" /> Remind pending</Button>}
        <Button size="sm" variant="ghost" className="gap-1" asChild><a href={`/api/agreements/${id}?format=csv`}><Download className="h-4 w-4" /> Export</a></Button>
      </div>
      <div className="max-h-[50vh] space-y-1 overflow-y-auto">
        {rows.map((r) => (
          <div key={r.userId} className="flex flex-wrap justify-between gap-2 rounded border border-slate-100 px-2 py-1.5">
            <span>{r.name} <span className="text-xs text-slate-400">{r.contact}</span></span>
            <span className="text-xs text-slate-500">{r.acceptedAt ? new Date(r.acceptedAt).toLocaleString('en-GB') : 'not yet'}</span>
          </div>
        ))}
        {!rows.length && <p className="text-slate-500">Nobody.</p>}
      </div>
    </div>
  )
}

export default function AgreementsPage() {
  const { data: session } = useSession()
  const role = session?.user?.role
  const allowed = !!role && checkPermission(role, 'agreements', 'read')
  const canEdit = !!role && checkPermission(role, 'agreements', 'update')
  const [edit, setEdit] = useState<Agreement | 'new' | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const { data, isLoading } = useQuery({ queryKey: ['agreements'], queryFn: () => fetchApi<Agreement[]>('/api/agreements'), enabled: allowed })
  if (!role) return null
  if (!allowed) return <AccessDenied title="Agreements" message="You don't have access to agreements." />
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900"><FileSignature className="h-7 w-7 text-indigo-600" /> Agreements</h1>
          <p className="mt-1 text-sm text-slate-500">
            What parents, students and staff must accept. Switched-on mandatory agreements block the portal until accepted. Changing a text publishes a new version that everyone accepts again.
            The starting texts are DRAFTS — review them (ideally with a lawyer) before switching them on.
          </p>
        </div>
        {checkPermission(role, 'agreements', 'create') && <Button className="gap-1" onClick={() => setEdit('new')}><Plus className="h-4 w-4" /> New agreement</Button>}
      </div>
      {isLoading ? <Loader2 className="h-5 w-5 animate-spin text-slate-400" /> : (
        <div className="grid gap-3 md:grid-cols-2">
          {(data ?? []).map((a) => (
            <Card key={a.id} className={a.isActive ? '' : 'opacity-75'}>
              <CardHeader className="pb-2">
                <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
                  <span>{a.titleEn} <span className="text-sm font-normal text-slate-400" dir="rtl">· {a.titleAr}</span></span>
                  <span className={`rounded-full border px-2 py-0.5 text-xs ${a.isActive ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-500'}`}>{a.isActive ? 'On' : 'Off'}</span>
                </CardTitle>
                <CardDescription>{AUD[a.audience]} · version {a.version} · {a.mandatory ? 'mandatory' : 'optional'} · {a.acceptedCurrent} accepted this version</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {canEdit && <Button size="sm" variant="outline" onClick={() => setEdit(a)}>Edit</Button>}
                <Button size="sm" variant="outline" className="gap-1" onClick={() => setStatus(a.id)}><Users className="h-4 w-4" /> Who accepted</Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <Dialog open={!!edit} onOpenChange={(o) => { if (!o) setEdit(null) }}>
        <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto">
          <DialogHeader><DialogTitle>{edit === 'new' ? 'New agreement' : 'Edit agreement'}</DialogTitle></DialogHeader>
          {edit && <Editor a={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
        </DialogContent>
      </Dialog>
      <Dialog open={!!status} onOpenChange={(o) => { if (!o) setStatus(null) }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Who accepted the current version</DialogTitle></DialogHeader>
          {status && <StatusView id={status} canRemind={canEdit} />}
        </DialogContent>
      </Dialog>
    </div>
  )
}
