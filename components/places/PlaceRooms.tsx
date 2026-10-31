'use client'

/**
 * a02 M1 batch 3 (2026-10-31): rooms of a branch / partner place — none, named rooms (capacity, type) or a number of
 * rooms per weekday; weekly use of each room. API /api/places/[campusId]/rooms.
 */

import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSession } from 'next-auth/react'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { L, dayName, useI18n } from '@/lib/i18n/client'
import { Loader2, Plus } from 'lucide-react'

interface Room { id: string; name: string; capacity: number; kind: string | null; isActive: boolean }
interface Data {
  campus: { id: string; roomMode: 'NONE' | 'FIXED' | 'DAILY' }
  settings: { sessionMinutes: number }
  rooms: Room[]
  dayCounts: number[]
  usage: { roomId: string; minutesPerWeek: number; sessions: { label: string; dayOfWeek: number; time: string }[] }[]
  unplaced: number
}

const KINDS: [string, string, string][] = [['CLASSROOM', 'Classroom', 'قاعة عادية'], ['ROBOTICS', 'Robotics lab', 'معمل روبوتكس'], ['COMPUTER', 'Computer lab', 'معمل كمبيوتر']]

export function PlaceRooms({ campusId, canEdit }: { campusId: string; canEdit: boolean }) {
  const ar = useI18n().locale === 'ar'
  const qc = useQueryClient()
  const { data: session } = useSession()
  const { data } = useQuery({ queryKey: ['place-rooms', campusId], queryFn: () => fetchApi<Data>(`/api/places/${campusId}/rooms`) })
  const [mode, setMode] = useState<Data['campus']['roomMode']>('NONE')
  const [counts, setCounts] = useState<number[]>([0, 0, 0, 0, 0, 0, 0])
  const [nr, setNr] = useState({ name: '', capacity: '', kind: 'CLASSROOM' })
  const [minutes, setMinutes] = useState('')
  useEffect(() => { if (data) { setMode(data.campus.roomMode); setCounts(data.dayCounts); setMinutes(String(data.settings.sessionMinutes)) } }, [data])
  const refresh = () => qc.invalidateQueries({ queryKey: ['place-rooms', campusId] })
  const onErr = (e: Error) => notify.error(e.message)
  const saveMode = useMutation({ mutationFn: () => fetchApi(`/api/places/${campusId}/rooms`, { method: 'PUT', body: JSON.stringify({ roomMode: mode, dayCounts: counts }) }), onSuccess: () => { notify.success(L('Saved', 'اتحفظ')); refresh() }, onError: onErr })
  const addRoom = useMutation({ mutationFn: () => fetchApi(`/api/places/${campusId}/rooms`, { method: 'POST', body: JSON.stringify({ name: nr.name, capacity: Number(nr.capacity), kind: nr.kind }) }), onSuccess: () => { setNr({ name: '', capacity: '', kind: 'CLASSROOM' }); refresh() }, onError: onErr })
  const editRoom = useMutation({ mutationFn: (v: { id: string } & Partial<Room>) => fetchApi(`/api/places/${campusId}/rooms/${v.id}`, { method: 'PATCH', body: JSON.stringify({ capacity: v.capacity, isActive: v.isActive }) }), onSuccess: refresh, onError: onErr })
  const saveMinutes = useMutation({ mutationFn: () => fetchApi('/api/rooms/settings', { method: 'PUT', body: JSON.stringify({ sessionMinutes: Number(minutes) }) }), onSuccess: () => { notify.success(L('Saved', 'اتحفظ')); refresh() }, onError: onErr })

  if (!data) return <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
  const kindLabel = (k: string | null) => KINDS.find((x) => x[0] === k)?.[ar ? 2 : 1] ?? k ?? ''
  const isAdmin = ['SUPER_ADMIN', 'ADMIN'].includes(session?.user?.role ?? '')
  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-slate-800">{L('Rooms here:', 'القاعات هنا:')}</span>
        <select aria-label={L('How rooms are kept', 'نظام القاعات')} className="h-8 rounded-md border px-2 text-sm" disabled={!canEdit} value={mode} onChange={(e) => setMode(e.target.value as Data['campus']['roomMode'])}>
          <option value="NONE">{L('Not kept (no checks)', 'مش متسجلة (من غير فحص)')}</option>
          <option value="FIXED">{L('Named rooms (name, size, type)', 'قاعات بأساميها (اسم، سعة، نوع)')}</option>
          <option value="DAILY">{L('A number of rooms per day', 'عدد قاعات لكل يوم')}</option>
        </select>
        {canEdit && (mode !== data.campus.roomMode || (mode === 'DAILY' && JSON.stringify(counts) !== JSON.stringify(data.dayCounts))) && <Button size="sm" onClick={() => saveMode.mutate()} disabled={saveMode.isPending}>{L('Save', 'احفظ')}</Button>}
      </div>

      {mode === 'DAILY' && (
        <div className="flex flex-wrap gap-2">
          {counts.map((c, d) => (
            <label key={d} className="flex flex-col items-center gap-0.5 text-xs">
              {dayName(d)}
              <Input type="number" min={0} className="h-8 w-16 text-center" disabled={!canEdit} value={c} onChange={(e) => setCounts(counts.map((x, i) => (i === d ? Number(e.target.value) : x)))} />
            </label>
          ))}
        </div>
      )}

      {mode === 'FIXED' && (
        <div className="space-y-1">
          {data.rooms.map((r) => {
            const u = data.usage.find((x) => x.roomId === r.id)
            return (
              <div key={r.id} className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 ${r.isActive ? 'border-slate-200' : 'border-dashed border-slate-200 text-slate-400'}`}>
                <span><b>{r.name}</b> · {kindLabel(r.kind)} · {L('seats', 'مكان')} {r.capacity}{!r.isActive && ` · ${L('stopped', 'موقوفة')}`}</span>
                <span className="text-xs text-slate-500">
                  {u && u.sessions.length ? `${Math.round(u.minutesPerWeek / 60 * 10) / 10} ${L('h / week', 'ساعة في الأسبوع')} · ${u.sessions.map((s) => `${s.label} (${dayName(s.dayOfWeek)} ${s.time})`).join('، ')}` : L('free all week', 'فاضية طول الأسبوع')}
                </span>
                {canEdit && (
                  <span className="flex gap-1">
                    <Input type="number" min={1} aria-label={L('Seats', 'السعة')} className="h-7 w-16" defaultValue={r.capacity} onBlur={(e) => Number(e.target.value) !== r.capacity && editRoom.mutate({ id: r.id, capacity: Number(e.target.value) })} />
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => editRoom.mutate({ id: r.id, isActive: !r.isActive })}>{r.isActive ? L('Stop', 'وقّف') : L('Use again', 'رجّعها')}</Button>
                  </span>
                )}
              </div>
            )
          })}
          {!data.rooms.length && <p className="text-xs text-slate-500">{L('No rooms yet.', 'لسه مفيش قاعات.')}</p>}
          {canEdit && (
            <div className="flex flex-wrap gap-2 pt-1">
              <Input className="h-8 w-40" aria-label={L('Room name', 'اسم القاعة')} placeholder={L('Room name', 'اسم القاعة')} value={nr.name} onChange={(e) => setNr({ ...nr, name: e.target.value })} />
              <Input className="h-8 w-24" type="number" min={1} aria-label={L('Seats', 'السعة')} placeholder={L('Seats', 'السعة')} value={nr.capacity} onChange={(e) => setNr({ ...nr, capacity: e.target.value })} />
              <select aria-label={L('Type', 'النوع')} className="h-8 rounded-md border px-2 text-sm" value={nr.kind} onChange={(e) => setNr({ ...nr, kind: e.target.value })}>
                {KINDS.map(([k, en, a]) => <option key={k} value={k}>{ar ? a : en}</option>)}
              </select>
              <Button size="sm" variant="outline" className="gap-1" disabled={!nr.name || !Number(nr.capacity) || addRoom.isPending} onClick={() => addRoom.mutate()}><Plus className="h-3.5 w-3.5" />{L('Add room', 'ضيف قاعة')}</Button>
            </div>
          )}
          {data.unplaced > 0 && <p className="text-xs text-amber-700">⚠ {L(`${data.unplaced} weekly branch session(s) here have no room yet — set them in each group's schedule.`, `${data.unplaced} حصة أسبوعية في الفرع هنا لسه ملهاش قاعة — حددها من مواعيد كل جروب.`)}</p>}
        </div>
      )}

      {mode !== 'NONE' && isAdmin && (
        <p className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
          {L('A session lasts', 'الحصة بتاخد')}
          <Input type="number" min={15} max={300} className="h-7 w-20" aria-label={L('Session minutes', 'دقايق الحصة')} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
          {L('minutes when checking clashes (all places)', 'دقيقة في فحص التعارض (كل الأماكن)')}
          {Number(minutes) !== data.settings.sessionMinutes && <Button size="sm" variant="outline" className="h-7" onClick={() => saveMinutes.mutate()}>{L('Save', 'احفظ')}</Button>}
        </p>
      )}
    </div>
  )
}
