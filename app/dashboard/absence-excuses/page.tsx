'use client'

/** Phase C: parents' absence excuses — review, history, settings (docs/design-phase-c.md). */

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { checkPermission } from '@/lib/rbac'
import { AccessDenied } from '@/components/AccessDenied'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Check, ClipboardX, Loader2, Plus, Trash2, X } from 'lucide-react'

interface Excuse { id: string; studentId: string; student: string; registrationNumber: string; group: string; sessionDate: string; reason: string; status: string; autoApproved: boolean; decisionNote: string | null; createdAt: string }
interface ListData { canDecide: boolean; excuses: Excuse[] }
interface Rule { scopeType: 'ALL' | 'TRACK' | 'COURSE' | 'GROUP'; scopeId: string | null; autoApprove: boolean; daysAfter: number }
interface Ref { id: string; name: string }

const STATUS: Record<string, string> = {
  PENDING: 'bg-amber-50 text-amber-700 border-amber-200',
  APPROVED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  REJECTED: 'bg-rose-50 text-rose-700 border-rose-200',
  CANCELLED: 'bg-slate-50 text-slate-500 border-slate-200',
}

function ExcuseList({ status }: { status: 'PENDING' | 'ALL' }) {
  const qc = useQueryClient()
  const [notes, setNotes] = useState<Record<string, string>>({})
  const { data, isLoading } = useQuery({ queryKey: ['absence-excuses', status], queryFn: () => fetchApi<ListData>(`/api/absence-excuses?status=${status}`) })
  const decide = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'approve' | 'reject' }) => fetchApi(`/api/absence-excuses/${id}`, { method: 'PATCH', body: JSON.stringify({ action, note: notes[id] || null }) }),
    onSuccess: (_r, v) => { notify.success(v.action === 'approve' ? 'Excuse accepted' : 'Excuse refused'); qc.invalidateQueries({ queryKey: ['absence-excuses'] }) },
    onError: (e: Error) => notify.error(e.message),
  })
  if (isLoading) return <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
  const rows = data?.excuses ?? []
  if (!rows.length) return <p className="py-6 text-center text-sm text-slate-500">{status === 'PENDING' ? 'Nothing waiting. 👌' : 'No excuses yet.'}</p>
  return (
    <div className="space-y-2">
      {rows.map((e) => (
        <div key={e.id} className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-slate-200 p-3 text-sm">
          <div className="min-w-0">
            <p className="font-semibold text-slate-800">{e.student} <span className="text-xs font-normal text-slate-400">{e.registrationNumber}</span></p>
            <p className="text-xs text-slate-500">{e.group} · session {new Date(`${e.sessionDate}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' })}</p>
            <p className="mt-1 text-slate-700">{e.reason}</p>
            {e.decisionNote && <p className="text-xs text-slate-500">Note: {e.decisionNote}</p>}
          </div>
          <div className="flex flex-col items-end gap-2">
            <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${STATUS[e.status] ?? ''}`}>{e.status === 'APPROVED' && e.autoApproved ? 'ACCEPTED (automatic)' : e.status}</span>
            {e.status === 'PENDING' && data?.canDecide && (
              <div className="flex flex-wrap items-center gap-1.5">
                <Input className="h-8 w-44 text-xs" placeholder="Note (optional)" value={notes[e.id] ?? ''} onChange={(ev) => setNotes({ ...notes, [e.id]: ev.target.value })} />
                <Button size="sm" className="h-8 gap-1" disabled={decide.isPending} onClick={() => decide.mutate({ id: e.id, action: 'approve' })}><Check className="h-3.5 w-3.5" /> Accept</Button>
                <Button size="sm" variant="outline" className="h-8 gap-1 text-rose-600" disabled={decide.isPending} onClick={() => decide.mutate({ id: e.id, action: 'reject' })}><X className="h-3.5 w-3.5" /> Refuse</Button>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

function ExcuseSettings({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['excuse-rules'], queryFn: () => fetchApi<{ rules: Rule[] }>('/api/absence-excuses/rules') })
  const { data: opts } = useQuery({ queryKey: ['discount-options'], queryFn: () => fetchApi<{ tracks: Ref[]; courses: Ref[]; groups: (Ref & { detail?: string })[] }>('/api/discounts/options'), enabled: canEdit })
  const [rules, setRules] = useState<Rule[]>([])
  useEffect(() => { if (data) setRules(data.rules.map((r) => ({ scopeType: r.scopeType, scopeId: r.scopeId, autoApprove: r.autoApprove, daysAfter: r.daysAfter }))) }, [data])
  const save = useMutation({
    mutationFn: () => fetchApi('/api/absence-excuses/rules', { method: 'PUT', body: JSON.stringify({ rules }) }),
    onSuccess: () => { notify.success('Excuse settings saved'); qc.invalidateQueries({ queryKey: ['excuse-rules'] }) },
    onError: (e: Error) => notify.error(e.message),
  })
  const options = (t: string): Ref[] => (t === 'TRACK' ? opts?.tracks ?? [] : t === 'COURSE' ? opts?.courses ?? [] : t === 'GROUP' ? (opts?.groups ?? []).map((g) => ({ id: g.id, name: g.detail ? `${g.name} (${g.detail})` : g.name })) : [])
  const set = (i: number, patch: Partial<Rule>) => setRules(rules.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Excuse settings</CardTitle>
        <CardDescription>
          For everyone, a track, a course or one group: accepted automatically or needs approval, and how many days after the session a parent can still send it.
          The most specific setting wins (group → course → track → everyone). With no setting: automatic, up to 2 days after.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {rules.map((r, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 p-2">
            <Select value={r.scopeType} onValueChange={(v) => set(i, { scopeType: v as Rule['scopeType'], scopeId: null })} disabled={!canEdit}>
              <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
              <SelectContent>{(['ALL', 'TRACK', 'COURSE', 'GROUP'] as const).map((t) => <SelectItem key={t} value={t}>{t === 'ALL' ? 'Everyone' : t.charAt(0) + t.slice(1).toLowerCase()}</SelectItem>)}</SelectContent>
            </Select>
            {r.scopeType !== 'ALL' && (
              <Select value={r.scopeId ?? ''} onValueChange={(v) => set(i, { scopeId: v })} disabled={!canEdit}>
                <SelectTrigger className="h-8 w-56"><SelectValue placeholder="Choose" /></SelectTrigger>
                <SelectContent>{options(r.scopeType).map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}</SelectContent>
              </Select>
            )}
            <Select value={r.autoApprove ? 'auto' : 'approval'} onValueChange={(v) => set(i, { autoApprove: v === 'auto' })} disabled={!canEdit}>
              <SelectTrigger className="h-8 w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Accepted automatically</SelectItem>
                <SelectItem value="approval">Needs approval</SelectItem>
              </SelectContent>
            </Select>
            <label className="flex items-center gap-1.5 text-xs text-slate-600">
              up to <Input type="number" min={0} max={30} className="h-8 w-16" value={r.daysAfter} onChange={(e) => set(i, { daysAfter: Math.max(0, Math.min(30, Number(e.target.value) || 0)) })} disabled={!canEdit} /> day(s) after the session
            </label>
            {canEdit && <button type="button" className="text-rose-500" onClick={() => setRules(rules.filter((_x, j) => j !== i))} aria-label="Remove"><Trash2 className="h-4 w-4" /></button>}
          </div>
        ))}
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" className="gap-1 text-xs" onClick={() => setRules([...rules, { scopeType: rules.some((r) => r.scopeType === 'ALL') ? 'GROUP' : 'ALL', scopeId: null, autoApprove: true, daysAfter: 2 }])}><Plus className="h-3.5 w-3.5" /> Add setting</Button>
            <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save</Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export default function AbsenceExcusesPage() {
  const { data: session } = useSession()
  const role = session?.user?.role
  if (!role) return null
  if (!checkPermission(role, 'absence_excuses', 'read')) return <AccessDenied title="Absence excuses" message="You don't have access to absence excuses." />
  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900"><ClipboardX className="h-7 w-7 text-rose-600" /> Absence excuses</h1>
        <p className="mt-1 text-sm text-slate-500">Parents send an excuse for a session from the portal. Accepted excuses mark the student &quot;Absent (excused)&quot;; the session still counts as used.</p>
      </div>
      <Tabs defaultValue="pending">
        <TabsList>
          <TabsTrigger value="pending">To review</TabsTrigger>
          <TabsTrigger value="all">All</TabsTrigger>
          {role !== 'TEACHER' && <TabsTrigger value="settings">Settings</TabsTrigger>}
        </TabsList>
        <TabsContent value="pending" className="mt-4"><ExcuseList status="PENDING" /></TabsContent>
        <TabsContent value="all" className="mt-4"><ExcuseList status="ALL" /></TabsContent>
        {role !== 'TEACHER' && <TabsContent value="settings" className="mt-4"><ExcuseSettings canEdit={checkPermission(role, 'absence_excuses', 'update')} /></TabsContent>}
      </Tabs>
    </div>
  )
}
