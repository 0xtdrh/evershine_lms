'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Users, Hourglass, ArrowRight } from 'lucide-react'

export interface Seats { max: number | null; count: number; free: number | null; full: boolean; waiting: number }
export interface WaitingRow { id: string; position: number; since: string; notes: string | null; student: { id: string; name: string; registrationNumber: string } }
interface AvailableGroup { id: string; label: string; campus: { id: string; name: string }; scheduleSlots: { dayOfWeek: number; time: string }[] | null; teacher: string | null; count: number; max: number | null; free: number | null }

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const slots = (s: AvailableGroup['scheduleSlots']) => (Array.isArray(s) && s.length ? s.map((x) => `${DAYS[x.dayOfWeek]} ${x.time}`).join(', ') : 'no schedule yet')

/** Group capacity (most students) + this group's waiting queue, with other groups of the same level that have room. */
export function GroupCapacityPanel({
  groupId,
  levelId,
  seats,
  waiting,
  canEdit,
}: {
  groupId: string
  levelId: string | null
  seats: Seats
  waiting: WaitingRow[]
  canEdit: boolean
}) {
  const qc = useQueryClient()
  const [max, setMax] = useState(seats.max == null ? '' : String(seats.max))
  const [openFor, setOpenFor] = useState<string | null>(null)
  const refresh = () => {
    for (const k of ['group-detail', 'groups', 'waiting-list']) qc.invalidateQueries({ queryKey: [k] })
  }

  const save = useMutation({
    mutationFn: () => fetchApi(`/api/groups/${groupId}`, { method: 'PATCH', body: JSON.stringify({ maxStudents: max.trim() ? Number(max) : null }) }),
    onSuccess: () => { notify.success('Saved'); refresh() },
    onError: (e: Error) => notify.error(e.message || 'Could not save'),
  })
  const { data: others, isFetching } = useQuery({
    queryKey: ['groups-available', levelId, groupId],
    queryFn: () => fetchApi<AvailableGroup[]>(`/api/groups/available?levelId=${levelId}&excludeId=${groupId}`),
    enabled: !!openFor && !!levelId,
  })
  const place = useMutation({
    mutationFn: ({ studentId, toGroupId }: { studentId: string; toGroupId: string }) =>
      fetchApi(`/api/groups/${toGroupId}/students`, { method: 'POST', body: JSON.stringify({ studentId }) }),
    onSuccess: () => { notify.success('Student added to the group'); setOpenFor(null); refresh() },
    onError: (e: Error) => notify.error(e.message || 'Could not add the student'),
  })

  return (
    <div className="mb-3 space-y-2 rounded-xl border border-slate-100 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Users className="h-4 w-4 text-indigo-600" />
        <span className="font-medium text-slate-700">
          {seats.count}{seats.max != null ? `/${seats.max}` : ''} students
          {seats.full && <span className="ml-1.5 rounded-full border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-600">Full</span>}
          {seats.waiting > 0 && <span className="ml-1.5 text-amber-700">· {seats.waiting} waiting</span>}
        </span>
        {canEdit && (
          <span className="ml-auto flex items-center gap-1.5">
            <span className="text-xs text-slate-500">Most students</span>
            <Input className="h-7 w-20 text-xs" type="number" min={1} placeholder="no limit" value={max} onChange={(e) => setMax(e.target.value)} />
            <Button size="sm" variant="outline" className="h-7 text-xs" disabled={save.isPending} onClick={() => save.mutate()}>Save</Button>
          </span>
        )}
      </div>

      {waiting.length > 0 && (
        <div className="space-y-1.5">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-700"><Hourglass className="h-3.5 w-3.5" /> Waiting for this group</p>
          {waiting.map((w) => (
            <div key={w.id} className="rounded-lg border border-amber-100 bg-amber-50/50 px-2.5 py-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-800">#{w.position} {w.student.name} <span className="text-xs text-slate-400">{w.student.registrationNumber} · since {new Date(w.since).toLocaleDateString('en-GB')}</span></span>
                <span className="flex gap-1.5">
                  {!seats.full && (
                    <Button size="sm" className="h-6 text-[11px]" disabled={place.isPending} onClick={() => place.mutate({ studentId: w.student.id, toGroupId: groupId })}>Add here</Button>
                  )}
                  {levelId && (
                    <Button size="sm" variant="outline" className="h-6 text-[11px]" onClick={() => setOpenFor(openFor === w.id ? null : w.id)}>Other groups</Button>
                  )}
                </span>
              </div>
              {openFor === w.id && (
                <div className="mt-1.5 space-y-1">
                  {isFetching && <p className="text-xs text-slate-400">Looking for groups with free seats…</p>}
                  {!isFetching && (others ?? []).length === 0 && <p className="text-xs text-slate-500">No other group of this level has a free seat.</p>}
                  {(others ?? []).map((g) => (
                    <div key={g.id} className="flex items-center justify-between gap-2 rounded border border-slate-200 bg-white px-2 py-1 text-xs">
                      <span>{g.label} · {slots(g.scheduleSlots)}{g.teacher ? ` · ${g.teacher}` : ''} · {g.free == null ? 'no limit' : `${g.free} free`}{g.campus ? ` · ${g.campus.name}` : ''}</span>
                      <Button size="sm" variant="ghost" className="h-6 gap-1 text-[11px] text-indigo-600" disabled={place.isPending} onClick={() => place.mutate({ studentId: w.student.id, toGroupId: g.id })}>
                        Put in this group <ArrowRight className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
