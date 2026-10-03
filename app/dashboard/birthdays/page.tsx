'use client'

/** Phase C: birthdays of students, parents and staff — today / this week / this month. */

import { useState } from 'react'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import { useQuery } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { checkPermission } from '@/lib/rbac'
import { whatsappNumber } from '@/lib/students/portal-password'
import { AccessDenied } from '@/components/AccessDenied'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Cake, Loader2, MessageCircle, Printer } from 'lucide-react'

interface Person {
  kind: 'STUDENT' | 'GUARDIAN' | 'STAFF'; id: string; name: string; role: string | null; dateOfBirth: string; daysAway: number; turns: number
  campus: string | null; phone: string | null; groups: { id: string; label: string }[]; children: string[]; greeting: string
}
interface Ref { id: string; name?: string; label?: string }

const KIND: Record<Person['kind'], { label: string; cls: string }> = {
  STUDENT: { label: 'Student', cls: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  GUARDIAN: { label: 'Parent', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  STAFF: { label: 'Staff', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
}

export default function BirthdaysPage() {
  const { data: session } = useSession()
  const role = session?.user?.role
  const allowed = !!role && checkPermission(role, 'birthdays', 'read')
  const isTeacher = role === 'TEACHER'
  const [range, setRange] = useState('today')
  const [kind, setKind] = useState('ALL')
  const [campusId, setCampusId] = useState('all')
  const [groupId, setGroupId] = useState('all')
  const { data: campuses } = useQuery({ queryKey: ['campuses-list'], queryFn: () => fetchApi<Ref[]>('/api/campuses'), enabled: allowed && role === 'SUPER_ADMIN' })
  const { data: groups } = useQuery({ queryKey: ['groups-list-active'], queryFn: () => fetchApi<Ref[]>('/api/groups?status=ACTIVE'), enabled: allowed && !isTeacher })
  const qs = new URLSearchParams({ range, kind, ...(campusId !== 'all' && { campusId }), ...(groupId !== 'all' && { groupId }) })
  const { data, isLoading } = useQuery({ queryKey: ['birthdays', qs.toString()], queryFn: () => fetchApi<{ today: string; people: Person[] }>(`/api/birthdays?${qs}`), enabled: allowed })
  if (!role) return null
  if (!allowed) return <AccessDenied title="Birthdays" message="You don't have access to the birthdays page." />

  const logWhatsApp = (p: Person) => {
    if (p.kind !== 'STUDENT') return
    fetch('/api/contact-logs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ studentId: p.id, channel: 'WHATSAPP', reason: 'OTHER', summary: 'Birthday greeting sent on WhatsApp.', auto: true }) }).catch(() => undefined)
  }
  const when = (p: Person) => (p.daysAway === 0 ? 'Today 🎉' : p.daysAway === 1 ? 'Tomorrow' : new Date(`${data?.today}T00:00:00Z`).getTime() ? new Date(Date.parse(`${data?.today}T00:00:00Z`) + p.daysAway * 86_400_000).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC' }) : '')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900"><Cake className="h-7 w-7 text-pink-600" /> Birthdays</h1>
        <p className="mt-1 text-sm text-slate-500">
          Students, parents and staff (Egypt time). Every morning the system greets them in the portal; WhatsApp goes automatically once it is connected — until then use the button.
          Parents and staff need a date of birth in their profile to appear here.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Tabs value={range} onValueChange={setRange}>
          <TabsList>
            <TabsTrigger value="today">Today</TabsTrigger>
            <TabsTrigger value="week">This week</TabsTrigger>
            <TabsTrigger value="month">Next 30 days</TabsTrigger>
          </TabsList>
        </Tabs>
        {!isTeacher && (
          <Select value={kind} onValueChange={setKind}>
            <SelectTrigger className="h-9 w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Everyone</SelectItem>
              <SelectItem value="STUDENT">Students</SelectItem>
              <SelectItem value="GUARDIAN">Parents</SelectItem>
              <SelectItem value="STAFF">Staff</SelectItem>
            </SelectContent>
          </Select>
        )}
        {role === 'SUPER_ADMIN' && (
          <Select value={campusId} onValueChange={setCampusId}>
            <SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All branches</SelectItem>
              {(campuses ?? []).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        {!isTeacher && (
          <Select value={groupId} onValueChange={setGroupId}>
            <SelectTrigger className="h-9 w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All groups</SelectItem>
              {(groups ?? []).map((g) => <SelectItem key={g.id} value={g.id}>{g.label ?? g.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </div>

      {isLoading ? <Loader2 className="h-5 w-5 animate-spin text-slate-400" /> : !data?.people.length ? (
        <Card><CardContent className="py-10 text-center text-sm text-slate-500">No birthdays {range === 'today' ? 'today' : 'in this period'}.</CardContent></Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {data.people.map((p) => {
            const wa = whatsappNumber(p.phone)
            return (
              <Card key={`${p.kind}-${p.id}`} className={p.daysAway === 0 ? 'border-pink-300 bg-pink-50/40' : ''}>
                <CardContent className="space-y-2 pt-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-slate-800">
                        {p.kind === 'STUDENT' ? <Link href={`/dashboard/students/${p.id}`} className="hover:underline">{p.name}</Link> : p.name}
                      </p>
                      <p className="text-xs text-slate-500">
                        {p.kind === 'STAFF' && p.role ? `${p.role} · ` : ''}
                        {p.kind === 'GUARDIAN' && p.children.length ? `parent of ${p.children.join(', ')} · ` : ''}
                        {p.groups.length ? `${p.groups.map((g) => g.label).join(', ')} · ` : ''}{p.campus ?? ''}
                      </p>
                    </div>
                    <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${KIND[p.kind].cls}`}>{KIND[p.kind].label}</span>
                  </div>
                  <p className="text-sm"><strong>{when(p)}</strong> · turns {p.turns}</p>
                  <div className="flex flex-wrap gap-2">
                    {wa && (
                      <Button asChild size="sm" className="h-8 gap-1 bg-emerald-600 hover:bg-emerald-700">
                        <a href={`https://wa.me/${wa}?text=${encodeURIComponent(p.greeting)}`} target="_blank" rel="noopener noreferrer" onClick={() => logWhatsApp(p)}>
                          <MessageCircle className="h-3.5 w-3.5" /> {p.kind === 'STUDENT' ? 'Greet the parent on WhatsApp' : 'Greet on WhatsApp'}
                        </a>
                      </Button>
                    )}
                    {p.kind === 'STUDENT' && (
                      <Button asChild size="sm" variant="outline" className="h-8 gap-1">
                        <a href={`/birthday-card/${p.id}`} target="_blank" rel="noopener noreferrer"><Printer className="h-3.5 w-3.5" /> Birthday certificate</a>
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
