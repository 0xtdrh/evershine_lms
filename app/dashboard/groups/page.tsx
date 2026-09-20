'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Loader2, Users, MapPin, GraduationCap, Calendar, Clock } from 'lucide-react'

interface GroupSummary {
  id: string
  label: string
  campus: { id: string; name: string }
  course: { id: string; name: string } | null
  track: { id: string; name: string } | null
  level: { id: string; name: string; numberOfMonths: number; numberOfSessions: number } | null
  teacher: { id: string; name: string } | null
  studentCount: number
  startDate: string | null
  expectedEndDate: string | null
  scheduleSlots: { dayOfWeek: number; time: string }[] | null
  status: 'ACTIVE' | 'COMPLETED'
  displayStatus: 'ACTIVE' | 'COMPLETED' | 'UPCOMING'
}

interface GroupDetail extends Omit<GroupSummary, 'campus' | 'level'> {
  campus: { id: string; name: string }
  batch: { id: string; name: string }
  shift: { id: string; name: string }
  level: (GroupSummary['level'] & { pricingType: string; monthlyPrice: number | null; fullLevelPrice: number | null }) | null
  enrollments: {
    id: string
    rollNumber: string
    student: { id: string; firstName: string; lastName: string; fullNameEn: string | null; registrationNumber: string }
  }[]
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function formatDate(d: string | null): string {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-EG', { day: 'numeric', month: 'short', year: 'numeric' })
}

function statusBadge(status: GroupSummary['displayStatus']) {
  if (status === 'COMPLETED') return <Badge className="bg-slate-100 text-slate-600 border-slate-200">Completed</Badge>
  if (status === 'UPCOMING') return <Badge className="bg-amber-50 text-amber-700 border-amber-100">Upcoming</Badge>
  return <Badge className="bg-emerald-50 text-emerald-700 border-emerald-100">Active</Badge>
}

export default function GroupsPage() {
  const { data: groups = [], isLoading } = useQuery<GroupSummary[]>({
    queryKey: ['groups'],
    queryFn: () => fetchApi('/api/groups'),
  })

  const [filter, setFilter] = useState<'ACTIVE' | 'UPCOMING' | 'COMPLETED'>('ACTIVE')
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null)

  const filtered = useMemo(() => groups.filter((g) => g.displayStatus === filter), [groups, filter])

  const { data: detail, isLoading: isDetailLoading } = useQuery<GroupDetail>({
    queryKey: ['group-detail', selectedGroupId],
    queryFn: () => fetchApi(`/api/groups/${selectedGroupId}`),
    enabled: !!selectedGroupId,
  })

  const counts = useMemo(() => ({
    ACTIVE: groups.filter((g) => g.displayStatus === 'ACTIVE').length,
    UPCOMING: groups.filter((g) => g.displayStatus === 'UPCOMING').length,
    COMPLETED: groups.filter((g) => g.displayStatus === 'COMPLETED').length,
  }), [groups])

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Groups</h1>
        <CardDescription>Every group — where it is, who&apos;s in it, and its schedule.</CardDescription>
      </div>

      <div className="flex gap-2">
        {(['ACTIVE', 'UPCOMING', 'COMPLETED'] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`text-sm px-4 py-2 rounded-xl border transition-colors ${
              filter === f ? 'bg-indigo-600 text-white border-indigo-600' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            {f === 'ACTIVE' ? 'Active' : f === 'UPCOMING' ? 'Upcoming' : 'Completed'}
            <span className={filter === f ? 'text-indigo-100 ml-1.5' : 'text-slate-400 ml-1.5'}>{counts[f]}</span>
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-slate-400 text-center py-16">No groups here.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {filtered.map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => setSelectedGroupId(g.id)}
              className="text-left p-4 rounded-2xl border border-slate-100 hover:border-indigo-200 hover:bg-indigo-50/30 transition-colors"
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <p className="font-semibold text-slate-900">{g.label}</p>
                {statusBadge(g.displayStatus)}
              </div>
              <p className="text-sm text-slate-600">
                {g.course?.name ?? 'No course set'}{g.level && ` · ${g.level.name}`}
              </p>
              <div className="mt-3 space-y-1 text-xs text-slate-500">
                <p className="flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5" /> {g.campus.name}</p>
                <p className="flex items-center gap-1.5"><Users className="w-3.5 h-3.5" /> {g.studentCount} students {g.teacher && `· ${g.teacher.name}`}</p>
                <p className="flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" /> {formatDate(g.startDate)} → {formatDate(g.expectedEndDate)}</p>
                {g.scheduleSlots && g.scheduleSlots.length > 0 && (
                  <p className="flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5" />
                    {g.scheduleSlots.map((s) => `${DAY_NAMES[s.dayOfWeek]} ${s.time}`).join(', ')}
                  </p>
                )}
              </div>
            </button>
          ))}
        </div>
      )}

      <Dialog open={!!selectedGroupId} onOpenChange={(o) => { if (!o) setSelectedGroupId(null) }}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{detail?.label ?? 'Group'}</DialogTitle>
            <DialogDescription>
              {detail?.course?.name}{detail?.level && ` · ${detail.level.name}`}{detail?.track && ` · ${detail.track.name} track`}
            </DialogDescription>
          </DialogHeader>

          {isDetailLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>
          ) : detail ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs text-slate-400">Branch</p>
                  <p className="text-slate-800">{detail.campus.name}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400">Instructor</p>
                  <p className="text-slate-800">{detail.teacher?.name ?? '— not assigned —'}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400">Starts</p>
                  <p className="text-slate-800">{formatDate(detail.startDate)}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400">Expected to finish</p>
                  <p className="text-slate-800">{formatDate(detail.expectedEndDate)}</p>
                </div>
                {detail.level && (
                  <div className="col-span-2">
                    <p className="text-xs text-slate-400">Level pricing</p>
                    <p className="text-slate-800">
                      {detail.level.pricingType === 'MONTHLY'
                        ? `${detail.level.monthlyPrice ?? '—'} / month`
                        : `${detail.level.fullLevelPrice ?? '—'} full level`}
                      {' · '}{detail.level.numberOfSessions} sessions over {detail.level.numberOfMonths} months
                    </p>
                  </div>
                )}
                {detail.scheduleSlots && detail.scheduleSlots.length > 0 && (
                  <div className="col-span-2">
                    <p className="text-xs text-slate-400">Weekly schedule</p>
                    <p className="text-slate-800">
                      {detail.scheduleSlots.map((s) => `${DAY_NAMES[s.dayOfWeek]} ${s.time}`).join(', ')}
                    </p>
                  </div>
                )}
              </div>

              <div>
                <p className="text-sm font-medium text-slate-700 mb-2 flex items-center gap-1.5">
                  <GraduationCap className="w-4 h-4 text-indigo-600" /> Students ({detail.enrollments.length})
                </p>
                {detail.enrollments.length === 0 ? (
                  <p className="text-sm text-slate-400 text-center py-4">No students enrolled yet.</p>
                ) : (
                  <div className="border border-slate-100 rounded-xl divide-y divide-slate-100 max-h-64 overflow-y-auto">
                    {detail.enrollments.map((e) => (
                      <div key={e.id} className="flex items-center justify-between px-3 py-2 text-sm">
                        <p className="text-slate-800">{e.student.fullNameEn || `${e.student.firstName} ${e.student.lastName}`}</p>
                        <p className="text-xs text-slate-400">{e.student.registrationNumber}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}
