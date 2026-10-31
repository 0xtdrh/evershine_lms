'use client'

/**
 * a02 M1 batch 4 (2026-10-31): an instructor's working hours — for each weekday a fixed SHIFT or AVAILABLE hours, in a
 * place / online only / anywhere. No hours = always available. Groups outside them are refused; substitutes are
 * suggested only from free instructors. API /api/teachers/[id]/work-hours.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { L, dayName, useI18n } from '@/lib/i18n/client'
import { ChevronLeft, Clock, Plus, X } from 'lucide-react'

interface Row { dayOfWeek: number; fromTime: string; toTime: string; kind: 'SHIFT' | 'AVAILABLE'; campusId: string | null; onlineOnly: boolean }
interface Data { teacher: { id: string; name: string }; rows: Row[]; sessions: { label: string; dayOfWeek: number; time: string; mode: string }[]; canEdit: boolean }
interface Place { id: string; name: string; label?: string }

export default function WorkHoursPage() {
  useI18n()
  const { id } = useParams<{ id: string }>()
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['work-hours', id], queryFn: () => fetchApi<Data>(`/api/teachers/${id}/work-hours`) })
  const { data: places = [] } = useQuery<Place[]>({ queryKey: ['campuses'], queryFn: () => fetchApi('/api/campuses') })
  const [rows, setRows] = useState<Row[]>([])
  useEffect(() => { if (data) setRows(data.rows) }, [data])
  const save = useMutation({
    mutationFn: () => fetchApi(`/api/teachers/${id}/work-hours`, { method: 'PUT', body: JSON.stringify({ rows }) }),
    onSuccess: () => { notify.success(L('Saved', 'اتحفظ')); qc.invalidateQueries({ queryKey: ['work-hours', id] }) },
    onError: (e: Error) => notify.error(e.message),
  })
  const set = (i: number, patch: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const where = (r: Row) => (r.onlineOnly ? 'ONLINE' : r.campusId ?? '')
  if (!data) return null
  const can = data.canEdit
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <Link href="/dashboard/teachers" className="inline-flex items-center gap-1 text-xs text-slate-500"><ChevronLeft className="h-3.5 w-3.5 rtl:rotate-180" />{L('Instructors', 'المدربين')}</Link>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><Clock className="h-4 w-4 text-indigo-600" />{L('Working hours', 'ساعات العمل')} — {data.teacher.name}</CardTitle>
          <CardDescription>{L('No hours = always available. With hours, groups outside them are refused and he is suggested as a substitute only when free. Two branches on the same day are refused (a Super Admin may force).', 'من غير ساعات = متاح دايماً. لو فيه ساعات، الجروبات اللي براها بتتمنع، وبيتقترح كبديل بس لو فاضي. فرعين في نفس اليوم ممنوع (الـ Super Admin بس يقدر يتخطّى).')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {rows.map((r, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <select aria-label={L('Day', 'اليوم')} className="h-9 rounded-md border px-2" disabled={!can} value={r.dayOfWeek} onChange={(e) => set(i, { dayOfWeek: Number(e.target.value) })}>
                {[0, 1, 2, 3, 4, 5, 6].map((d) => <option key={d} value={d}>{dayName(d)}</option>)}
              </select>
              <select aria-label={L('Kind', 'النوع')} className="h-9 rounded-md border px-2" disabled={!can} value={r.kind} onChange={(e) => set(i, { kind: e.target.value as Row['kind'] })}>
                <option value="SHIFT">{L('Shift', 'شيفت')}</option>
                <option value="AVAILABLE">{L('Available hours', 'ساعات متاح فيها')}</option>
              </select>
              <Input type="time" className="h-9 w-28" aria-label={L('From', 'من')} disabled={!can} value={r.fromTime} onChange={(e) => set(i, { fromTime: e.target.value })} />
              <Input type="time" className="h-9 w-28" aria-label={L('To', 'لحد')} disabled={!can} value={r.toTime} onChange={(e) => set(i, { toTime: e.target.value })} />
              <select aria-label={L('Where', 'فين')} className="h-9 rounded-md border px-2" disabled={!can} value={where(r)} onChange={(e) => set(i, e.target.value === 'ONLINE' ? { onlineOnly: true, campusId: null } : { onlineOnly: false, campusId: e.target.value || null })}>
                <option value="">{L('Any place', 'أي مكان')}</option>
                <option value="ONLINE">{L('Online only', 'أونلاين بس')}</option>
                {places.map((p) => <option key={p.id} value={p.id}>{p.label ?? p.name}</option>)}
              </select>
              {can && <button type="button" aria-label={L('Remove', 'شيل')} className="text-rose-600" onClick={() => setRows(rows.filter((_, j) => j !== i))}><X className="h-4 w-4" /></button>}
            </div>
          ))}
          {!rows.length && <p className="text-xs text-slate-500">{L('No hours — always available.', 'مفيش ساعات — متاح دايماً.')}</p>}
          {can && (
            <div className="flex gap-2 pt-2">
              <Button size="sm" variant="outline" className="gap-1" onClick={() => setRows([...rows, { dayOfWeek: 0, fromTime: '14:00', toTime: '20:00', kind: 'SHIFT', campusId: null, onlineOnly: false }])}><Plus className="h-3.5 w-3.5" />{L('Add hours', 'ضيف ساعات')}</Button>
              <Button size="sm" disabled={save.isPending} onClick={() => save.mutate()}>{L('Save', 'احفظ')}</Button>
            </div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">{L('His weekly sessions now', 'حصصه في الأسبوع دلوقتي')}</CardTitle></CardHeader>
        <CardContent className="space-y-1 text-sm">
          {!data.sessions.length && <p className="text-xs text-slate-500">{L('No running groups.', 'مفيش جروبات شغالة.')}</p>}
          {[...data.sessions].sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.time.localeCompare(b.time)).map((s, i) => (
            <p key={i}>{dayName(s.dayOfWeek)} {s.time} · {s.label} {s.mode === 'ONLINE' ? '💻' : s.mode === 'RECORDED' ? '🎬' : '🏫'}</p>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
