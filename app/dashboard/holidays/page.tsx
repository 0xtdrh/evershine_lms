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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { CalendarOff, Loader2, Trash2 } from 'lucide-react'

interface Holiday { id: string; date: string; name: string; campus: { id: string; name: string } | null }
interface Campus { id: string; name: string }

/** Branch / company days off: sessions on those days move to the next scheduled slot (phase A). */
export default function HolidaysPage() {
  const qc = useQueryClient()
  const { data: session } = useSession()
  const isSuper = session?.user?.role === 'SUPER_ADMIN'
  const { data: perms } = useQuery({
    queryKey: ['my-permissions', session?.user?.role],
    queryFn: () => fetchApi<{ permissions: Record<string, string[]> }>('/api/me/permissions'),
    staleTime: 60_000,
    enabled: !!session?.user?.role,
  })
  const canCreate = !!perms?.permissions?.holidays?.includes('create')
  const canDelete = !!perms?.permissions?.holidays?.includes('delete')
  const today = new Date().toISOString().slice(0, 10)
  const { data: rows, isLoading } = useQuery({ queryKey: ['holidays'], queryFn: () => fetchApi<Holiday[]>(`/api/holidays?from=${today}`) })
  const { data: campuses = [] } = useQuery({ queryKey: ['campuses'], queryFn: () => fetchApi<Campus[]>('/api/campuses') })
  const [form, setForm] = useState({ date: '', toDate: '', name: '', campusId: isSuper ? 'ALL' : '' })
  const add = useMutation({
    mutationFn: () => fetchApi<{ added: number }>('/api/holidays', {
      method: 'POST',
      body: JSON.stringify({ date: form.date, toDate: form.toDate || null, name: form.name, campusId: form.campusId === 'ALL' ? null : form.campusId || session?.user?.campusId || null }),
    }),
    onSuccess: (r) => { notify.success(r.added ? `${r.added} day(s) added` : 'Already a holiday'); setForm({ ...form, date: '', toDate: '', name: '' }); qc.invalidateQueries({ queryKey: ['holidays'] }); qc.invalidateQueries({ queryKey: ['groups-schedule'] }) },
    onError: (e: Error) => notify.error(e.message || 'Could not add it'),
  })
  const remove = useMutation({
    mutationFn: (id: string) => fetchApi(`/api/holidays/${id}`, { method: 'DELETE' }),
    onSuccess: () => { notify.success('Removed'); qc.invalidateQueries({ queryKey: ['holidays'] }); qc.invalidateQueries({ queryKey: ['groups-schedule'] }) },
    onError: (e: Error) => notify.error(e.message || 'Could not remove it'),
  })
  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900"><CalendarOff className="h-5 w-5 text-indigo-600" /> Holidays</h1>
        <p className="text-sm text-slate-500">A session that falls on a holiday moves to the group&apos;s next scheduled day — no session is lost. To keep the month on time, add an extra session from the group page.</p>
      </div>
      {canCreate && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Add a holiday</CardTitle><CardDescription>One day, or a range (up to 60 days).</CardDescription></CardHeader>
          <CardContent className="flex flex-wrap items-end gap-2 text-sm">
            <div className="space-y-1"><Label className="text-xs">From</Label><Input type="date" className="h-9 w-40" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
            <div className="space-y-1"><Label className="text-xs">To (optional)</Label><Input type="date" className="h-9 w-40" value={form.toDate} onChange={(e) => setForm({ ...form, toDate: e.target.value })} /></div>
            <div className="min-w-[180px] flex-1 space-y-1"><Label className="text-xs">Name</Label><Input className="h-9" placeholder="e.g. Eid al-Adha" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            {isSuper && (
              <div className="space-y-1">
                <Label className="text-xs">For</Label>
                <Select value={form.campusId || 'ALL'} onValueChange={(v) => setForm({ ...form, campusId: v })}>
                  <SelectTrigger className="h-9 w-48"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">The whole company</SelectItem>
                    {campuses.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <Button className="h-9" disabled={!form.date || form.name.trim().length < 2 || add.isPending} onClick={() => add.mutate()}>Add</Button>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Coming holidays</CardTitle></CardHeader>
        <CardContent className="space-y-1.5 text-sm">
          {isLoading && <p className="flex items-center gap-2 text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>}
          {(rows ?? []).length === 0 && !isLoading && <p className="text-slate-500">No holidays coming.</p>}
          {(rows ?? []).map((h) => (
            <div key={h.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-1.5">
              <span>
                <strong>{new Date(`${h.date}T00:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</strong>
                {' · '}{h.name}
                <span className="ml-2 text-xs text-slate-500">{h.campus ? h.campus.name : 'Whole company'}</span>
              </span>
              {canDelete && <button type="button" className="text-rose-500 hover:text-rose-700" onClick={() => remove.mutate(h.id)} aria-label="Remove"><Trash2 className="h-4 w-4" /></button>}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
