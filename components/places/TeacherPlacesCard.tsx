'use client'

/**
 * M0: an instructor's places (where he can be chosen for groups / substitutions), pay per place (between the group's
 * own rule and the instructor's default) and employment periods (TechNova / partner, instructor / trainee without pay).
 */

import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi, fetchPaginatedApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { L } from '@/lib/i18n/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { MapPin, Plus, Trash2 } from 'lucide-react'
import { DateInput } from '@/components/ui/date-input'
import { campusLabel } from '@/lib/places/label'

interface Pay { campusId: string; fixed: number | null; percent: number | null; perSession: number | null }
interface Period { employer: 'TECHNOVA' | 'PARTNER'; partnerName?: string | null; kind: 'TEACHER' | 'TRAINEE'; fromDate: string; toDate?: string | null; note?: string | null }
interface Data { primary: string; allLocations: boolean; campusIds: string[]; pay: Pay[]; employment: Period[] }
interface Campus { id: string; name: string; kind?: string }

export function TeacherPlacesCard({ teacherId }: { teacherId: string }) {
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['teacher-places', teacherId], queryFn: () => fetchApi<Data>(`/api/teachers/${teacherId}/places`), retry: false })
  const { data: campuses } = useQuery({ queryKey: ['campuses-all'], queryFn: () => fetchPaginatedApi<Campus>('/api/campuses?limit=100') })
  const [d, setD] = useState<Data | null>(null)
  useEffect(() => { if (data) setD(data) }, [data])
  const save = useMutation({
    mutationFn: () => fetchApi(`/api/teachers/${teacherId}/places`, { method: 'PUT', body: JSON.stringify(d) }),
    onSuccess: () => { notify.success(L('Saved', 'اتحفظ')); qc.invalidateQueries({ queryKey: ['teacher-places', teacherId] }) },
    onError: (e: Error) => notify.error(e.message),
  })
  if (!d) return null
  const places = campuses?.data ?? []
  const serves = d.allLocations ? places : places.filter((c) => c.id === d.primary || d.campusIds.includes(c.id))
  const payOf = (campusId: string) => d.pay.find((p) => p.campusId === campusId) ?? { campusId, fixed: null, percent: null, perSession: null }
  const setPay = (campusId: string, patch: Partial<Pay>) => setD({ ...d, pay: [...d.pay.filter((p) => p.campusId !== campusId), { ...payOf(campusId), ...patch }] })
  const num = (v: string) => (v === '' ? null : Number(v))
  const setPeriod = (i: number, patch: Partial<Period>) => setD({ ...d, employment: d.employment.map((e, j) => (j === i ? { ...e, ...patch } : e)) })
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base"><MapPin className="h-4 w-4 text-indigo-600" /> {L('Places, pay per place, employment', 'الأماكن، والأجر لكل مكان، والتوظيف')}</CardTitle>
        <CardDescription>{L('When a group is made in a place, only the instructors of that place can be chosen. Pay: the group rule wins, then the place, then the default.', 'لما جروب يتعمل في مكان، بيظهر مدربين المكان ده بس. الأجر: قاعدة الجروب الأول، بعدها المكان، بعدها الافتراضي.')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="space-y-1">
          <p>{L('Primary place', 'المكان الأساسي')}: <b>{(() => { const c = places.find((x) => x.id === d.primary); return c ? campusLabel(c) : '—' })()}</b></p>
          <label className="flex items-center gap-2"><input type="checkbox" checked={d.allLocations} onChange={(e) => setD({ ...d, allLocations: e.target.checked })} /> {L('Works in every place', 'بيشتغل في كل الأماكن')}</label>
          {!d.allLocations && <div className="flex flex-wrap gap-3">{places.filter((c) => c.id !== d.primary).map((c) => (
            <label key={c.id} className="flex items-center gap-1 text-xs"><input type="checkbox" checked={d.campusIds.includes(c.id)} onChange={() => setD({ ...d, campusIds: d.campusIds.includes(c.id) ? d.campusIds.filter((x) => x !== c.id) : [...d.campusIds, c.id] })} /> {campusLabel(c)}{c.kind === 'PARTNER' ? ' 🤝' : ''}</label>
          ))}</div>}
        </div>
        <div className="space-y-1">
          <p className="font-medium">{L('Pay in each place (empty = his default)', 'الأجر في كل مكان (فاضي = الافتراضي بتاعه)')}</p>
          {serves.map((c) => { const p = payOf(c.id); return (
            <div key={c.id} className="flex flex-wrap items-center gap-2 text-xs">
              <span className="w-36 truncate" title={campusLabel(c)}>{campusLabel(c)}</span>
              <label className="flex items-center gap-1">{L('Fixed', 'ثابت')} <Input type="number" className="h-8 w-24" value={p.fixed ?? ''} onChange={(e) => setPay(c.id, { fixed: num(e.target.value) })} /></label>
              <label className="flex items-center gap-1">% <Input type="number" className="h-8 w-20" value={p.percent ?? ''} onChange={(e) => setPay(c.id, { percent: num(e.target.value) })} /></label>
              <label className="flex items-center gap-1">{L('Per session', 'للحصة')} <Input type="number" className="h-8 w-24" value={p.perSession ?? ''} onChange={(e) => setPay(c.id, { perSession: num(e.target.value) })} /></label>
            </div>
          ) })}
        </div>
        <div className="space-y-2">
          <p className="font-medium">{L('Employment periods (empty = paid by TechNova as usual)', 'فترات التوظيف (فاضي = TechNova بتقبّضه عادي)')}</p>
          {d.employment.map((e, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 text-xs">
              <select className="h-8 rounded border border-slate-200 px-1" value={e.employer} onChange={(x) => setPeriod(i, { employer: x.target.value as Period['employer'] })}><option value="TECHNOVA">TechNova</option><option value="PARTNER">{L('Partner', 'شريك')}</option></select>
              {e.employer === 'PARTNER' && <Input className="h-8 w-36" placeholder={L('Partner name', 'اسم الشريك')} value={e.partnerName ?? ''} onChange={(x) => setPeriod(i, { partnerName: x.target.value })} />}
              <select className="h-8 rounded border border-slate-200 px-1" value={e.kind} onChange={(x) => setPeriod(i, { kind: x.target.value as Period['kind'] })}><option value="TEACHER">{L('Instructor', 'مدرب')}</option><option value="TRAINEE">{L('Trainee (no pay)', 'متدرب (من غير مرتب)')}</option></select>
              {L('from', 'من')} <DateInput className="h-8 w-36" value={e.fromDate} onChange={(x) => setPeriod(i, { fromDate: x.target.value })} />
              {L('to', 'لحد')} <DateInput className="h-8 w-36" value={e.toDate ?? ''} onChange={(x) => setPeriod(i, { toDate: x.target.value || null })} />
              <Button type="button" size="sm" variant="ghost" onClick={() => setD({ ...d, employment: d.employment.filter((_, j) => j !== i) })}><Trash2 className="h-3 w-3 text-rose-500" /></Button>
            </div>
          ))}
          <Button type="button" size="sm" variant="outline" className="gap-1" onClick={() => setD({ ...d, employment: [...d.employment, { employer: 'TECHNOVA', kind: 'TEACHER', fromDate: new Date().toISOString().slice(0, 10), toDate: null }] })}><Plus className="h-3 w-3" /> {L('Period', 'فترة')}</Button>
        </div>
        <Button disabled={save.isPending} onClick={() => save.mutate()}>{L('Save', 'حفظ')}</Button>
      </CardContent>
    </Card>
  )
}
