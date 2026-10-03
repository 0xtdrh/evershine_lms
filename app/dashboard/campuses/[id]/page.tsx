'use client'

import { useEffect, useState } from 'react'
import { use } from 'react'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ArrowLeft, Building2, Loader2, MapPin, Phone, MessageCircle, Clock, Users, Pencil } from 'lucide-react'

interface Profile {
  campus: {
    id: string; name: string; code: string; address: string; phone: string; email: string
    mapUrl: string | null; whatsapp: string | null; workingHours: string | null; roomsCount: number | null
    maxStudents: number | null; managerUserId: string | null; profileNotes: string | null; isActive: boolean; manager: string | null
  }
  team: {
    staff: { userId: string; name: string; role: string; email: string; department: string | null }[]
    instructors: { id: string; name: string; designation: string; phone: string }[]
  }
  stats: { activeGroups: number; activeStudents: number; monthIncome: number; overdueInvoices: number; waiting: number; fullness: number | null }
}

const money = (n: number) => `${n.toLocaleString('en-US', { maximumFractionDigits: 0 })} EGP`

/** Branch profile: details, team and live numbers (phase A). */
export default function CampusProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const qc = useQueryClient()
  const { data: session } = useSession()
  const { data: perms } = useQuery({
    queryKey: ['my-permissions', session?.user?.role],
    queryFn: () => fetchApi<{ permissions: Record<string, string[]> }>('/api/me/permissions'),
    staleTime: 60_000,
    enabled: !!session?.user?.role,
  })
  const canEdit = !!perms?.permissions?.campuses?.includes('update')
  const { data, isLoading, error } = useQuery({ queryKey: ['campus-profile', id], queryFn: () => fetchApi<Profile>(`/api/campuses/${id}/profile`) })
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<Record<string, string>>({})
  useEffect(() => {
    if (!data) return
    const c = data.campus
    setForm({
      address: c.address, phone: c.phone, email: c.email, mapUrl: c.mapUrl ?? '', whatsapp: c.whatsapp ?? '', workingHours: c.workingHours ?? '',
      roomsCount: c.roomsCount == null ? '' : String(c.roomsCount), maxStudents: c.maxStudents == null ? '' : String(c.maxStudents),
      managerUserId: c.managerUserId ?? '', profileNotes: c.profileNotes ?? '',
    })
  }, [data])
  const save = useMutation({
    mutationFn: () => fetchApi(`/api/campuses/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        address: form.address, phone: form.phone, email: form.email,
        mapUrl: form.mapUrl, whatsapp: form.whatsapp, workingHours: form.workingHours, profileNotes: form.profileNotes,
        managerUserId: form.managerUserId,
        roomsCount: form.roomsCount ? Number(form.roomsCount) : null,
        maxStudents: form.maxStudents ? Number(form.maxStudents) : null,
      }),
    }),
    onSuccess: () => { notify.success('Saved'); setEditing(false); qc.invalidateQueries({ queryKey: ['campus-profile', id] }) },
    onError: (e: Error) => notify.error(e.message || 'Could not save'),
  })
  const f = (k: string) => ({ value: form[k] ?? '', onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value }) })

  if (isLoading) return <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>
  if (error || !data) return <p className="text-sm text-rose-600">{(error as Error)?.message ?? 'Not found'}</p>
  const c = data.campus
  const s = data.stats
  const tiles: [string, string, string][] = [
    ['Active groups', String(s.activeGroups), 'text-indigo-700'],
    ['Active students', String(s.activeStudents), 'text-indigo-700'],
    ['Income this month', money(s.monthIncome), 'text-emerald-700'],
    ['Overdue invoices', String(s.overdueInvoices), s.overdueInvoices ? 'text-rose-700' : 'text-slate-700'],
    ['Waiting list', String(s.waiting), s.waiting ? 'text-amber-700' : 'text-slate-700'],
    ['Branch fullness', s.fullness == null ? '—' : `${s.fullness}%`, 'text-slate-700'],
  ]

  return (
    <div className="space-y-4">
      <Link href="/dashboard/campuses" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft className="h-4 w-4" /> Branches</Link>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900"><Building2 className="h-5 w-5 text-indigo-600" /> {c.name} <span className="text-sm font-normal text-slate-500">{c.code}</span></h1>
        {canEdit && !editing && <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setEditing(true)}><Pencil className="h-3.5 w-3.5" /> Edit details</Button>}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {tiles.map(([label, value, tone]) => (
          <Card key={label}><CardContent className="p-3"><p className="text-xs text-slate-500">{label}</p><p className={`text-lg font-bold ${tone}`}>{value}</p></CardContent></Card>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Details</CardTitle></CardHeader>
        <CardContent className="text-sm">
          {!editing ? (
            <div className="grid gap-2 md:grid-cols-2">
              <p className="flex items-start gap-2"><MapPin className="mt-0.5 h-4 w-4 text-slate-400" /> {c.address}{c.mapUrl && <a href={c.mapUrl} target="_blank" rel="noreferrer" className="ml-1 text-indigo-600 underline">map</a>}</p>
              <p className="flex items-center gap-2"><Phone className="h-4 w-4 text-slate-400" /> {c.phone} · {c.email}</p>
              <p className="flex items-center gap-2"><MessageCircle className="h-4 w-4 text-slate-400" /> {c.whatsapp ?? '—'}</p>
              <p className="flex items-start gap-2"><Clock className="mt-0.5 h-4 w-4 text-slate-400" /> <span className="whitespace-pre-wrap">{c.workingHours ?? '—'}</span></p>
              <p className="flex items-center gap-2"><Users className="h-4 w-4 text-slate-400" /> {c.roomsCount ?? '—'} rooms · up to {c.maxStudents ?? '—'} students</p>
              <p>Branch manager: <strong>{c.manager ?? '—'}</strong></p>
              {c.profileNotes && <p className="whitespace-pre-wrap text-slate-600 md:col-span-2">{c.profileNotes}</p>}
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1 md:col-span-2"><Label>Address</Label><Input {...f('address')} /></div>
              <div className="space-y-1"><Label>Phone</Label><Input {...f('phone')} /></div>
              <div className="space-y-1"><Label>Email</Label><Input {...f('email')} /></div>
              <div className="space-y-1"><Label>WhatsApp</Label><Input {...f('whatsapp')} placeholder="01xxxxxxxxx" /></div>
              <div className="space-y-1"><Label>Map link</Label><Input {...f('mapUrl')} placeholder="https://maps.google.com/..." /></div>
              <div className="space-y-1"><Label>Rooms</Label><Input type="number" min={0} {...f('roomsCount')} /></div>
              <div className="space-y-1"><Label>Most students</Label><Input type="number" min={0} {...f('maxStudents')} /></div>
              <div className="space-y-1 md:col-span-2">
                <Label>Branch manager</Label>
                <Select value={form.managerUserId || 'none'} onValueChange={(v) => setForm({ ...form, managerUserId: v === 'none' ? '' : v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">—</SelectItem>
                    {data.team.staff.map((m) => <SelectItem key={m.userId} value={m.userId}>{m.name} ({m.role})</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1 md:col-span-2"><Label>Working hours</Label><Textarea rows={2} {...f('workingHours')} placeholder="Sat–Thu 10:00–21:00, Fri closed" /></div>
              <div className="space-y-1 md:col-span-2"><Label>Notes</Label><Textarea rows={2} {...f('profileNotes')} /></div>
              <div className="flex justify-end gap-2 md:col-span-2">
                <Button variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
                <Button disabled={save.isPending} onClick={() => save.mutate()}>Save</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Staff ({data.team.staff.length})</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            {data.team.staff.length === 0 && <p className="text-slate-500">No staff accounts in this branch.</p>}
            {data.team.staff.map((m) => <p key={m.userId}>{m.name} <span className="text-xs text-slate-500">· {m.role}{m.department ? ` · ${m.department}` : ''}</span></p>)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Instructors ({data.team.instructors.length})</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            {data.team.instructors.length === 0 && <p className="text-slate-500">No instructors in this branch.</p>}
            {data.team.instructors.map((t) => <p key={t.id}>{t.name} <span className="text-xs text-slate-500">· {t.designation} · {t.phone}</span></p>)}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
