'use client'

/**
 * Partners part 1-B2: the groups, students and instructors of one place or several (a partner's places), with links to
 * each one and quick actions: add / open / remove a group, new admission / open a student / take a student out of a
 * group, add / remove an instructor for the place.
 */

import { useState } from 'react'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { L } from '@/lib/i18n/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Loader2, Plus, Search, Trash2, UserMinus } from 'lucide-react'

interface People {
  groups: { id: string; name: string; status: string; started: boolean; campus: { id: string; name: string }; level: string | null; students: number; unnamed: boolean; instructor: { id: string; name: string } | null }[]
  students: { id: string; name: string; registrationNumber: string; isActive: boolean; campus: { id: string; name: string }; groups: { enrollmentId: string; id: string; name: string }[] }[]
  instructors: { id: string; name: string; phone: string | null; primary: { id: string; name: string }; allPlaces: boolean; places: string[]; groups: number }[]
}

export function PlacePeople({ places }: { places: { id: string; name: string }[] }) {
  const qc = useQueryClient()
  const { data: session } = useSession()
  const { data: perms } = useQuery({
    queryKey: ['my-permissions', session?.user?.role],
    queryFn: () => fetchApi<{ permissions: Record<string, string[]> }>('/api/me/permissions'),
    staleTime: 60_000,
    enabled: !!session?.user?.role,
  })
  const can = (r: string, a: string) => !!perms?.permissions?.[r]?.includes(a)
  const [tab, setTab] = useState<'groups' | 'students' | 'instructors'>('groups')
  const [place, setPlace] = useState(places.length === 1 ? places[0].id : '')
  const [q, setQ] = useState('')
  const ids = place ? [place] : places.map((p) => p.id)
  const key = ['place-people', ids.join(',')]
  const { data, isLoading } = useQuery({ queryKey: key, queryFn: () => fetchApi<People>(`/api/places/people?campusIds=${ids.join(',')}`), enabled: ids.length > 0 })
  const target = place || places[0]?.id || ''
  const { data: addable = [] } = useQuery({
    queryKey: ['place-addable-instructors', target],
    queryFn: () => fetchApi<{ id: string; name: string; primary: string }[]>(`/api/places/${target}/instructors`),
    enabled: tab === 'instructors' && !!target && can('teachers', 'update'),
  })
  const [pick, setPick] = useState('')
  const refresh = () => { qc.invalidateQueries({ queryKey: ['place-people'] }); qc.invalidateQueries({ queryKey: ['place-addable-instructors'] }) }
  const err = (e: Error) => notify.error(e.message)
  const delGroup = useMutation({ mutationFn: (id: string) => fetchApi(`/api/groups/${id}`, { method: 'DELETE' }), onSuccess: () => { notify.success(L('Group removed', 'الجروب اتشال')); refresh() }, onError: err })
  const outOfGroup = useMutation({ mutationFn: (enrollmentId: string) => fetchApi(`/api/student-enrollments/${enrollmentId}`, { method: 'DELETE' }), onSuccess: () => { notify.success(L('Taken out of the group', 'اتشال من الجروب')); refresh() }, onError: err })
  const addTeacher = useMutation({ mutationFn: () => fetchApi(`/api/places/${target}/instructors`, { method: 'POST', body: JSON.stringify({ teacherId: pick }) }), onSuccess: () => { notify.success(L('Added', 'اتضاف')); setPick(''); refresh() }, onError: err })
  const removeTeacher = useMutation({ mutationFn: (teacherId: string) => fetchApi(`/api/places/${target}/instructors?teacherId=${teacherId}`, { method: 'DELETE' }), onSuccess: () => { notify.success(L('Removed from this place', 'اتشال من المكان ده')); refresh() }, onError: err })
  const match = (s: string) => !q || s.toLowerCase().includes(q.toLowerCase())
  const tabBtn = (t: typeof tab, label: string, n?: number) => (
    <button type="button" onClick={() => setTab(t)} className={`rounded-md px-3 py-1.5 text-xs font-medium ${tab === t ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>{label}{n !== undefined ? ` (${n})` : ''}</button>
  )
  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        {tabBtn('groups', L('Groups', 'الجروبات'), data?.groups.length)}
        {tabBtn('students', L('Students', 'الطلاب'), data?.students.length)}
        {tabBtn('instructors', L('Instructors', 'المدربين'), data?.instructors.length)}
        {places.length > 1 && (
          <select className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs" value={place} onChange={(e) => setPlace(e.target.value)}>
            <option value="">{L('All places', 'كل الأماكن')}</option>
            {places.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
        <div className="relative ms-auto"><Search className="absolute start-2 top-2 h-4 w-4 text-slate-400" /><Input className="h-8 w-48 ps-8 text-xs" placeholder={L('Search', 'دوّر')} value={q} onChange={(e) => setQ(e.target.value)} /></div>
      </div>
      {isLoading && <Loader2 className="h-5 w-5 animate-spin text-slate-400" />}

      {tab === 'groups' && data && (
        <div className="space-y-2">
          {can('class_sections', 'create') && target && <Link href={`/dashboard/groups?create=1&campusId=${target}`}><Button size="sm" variant="outline"><Plus className="me-1 h-4 w-4" />{L('Add group', 'ضيف جروب')}</Button></Link>}
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {data.groups.filter((g) => match(`${g.name} ${g.level ?? ''} ${g.instructor?.name ?? ''}`)).map((g) => (
              <li key={g.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                <Link href={`/dashboard/groups?group=${g.id}`} className="font-medium text-indigo-700 hover:underline">{g.name}</Link>
                <span className="text-xs text-slate-500">{g.level ?? ''}{places.length > 1 ? ` · ${g.campus.name}` : ''}</span>
                <span className="text-xs text-slate-600">· {g.students} {g.unnamed ? L('children (no names)', 'طفل (من غير أسماء)') : L('students', 'طالب')}</span>
                <span className="text-xs text-slate-600">· {g.instructor ? <Link className="hover:underline" href={`/dashboard/teachers/${g.instructor.id}`}>{g.instructor.name}</Link> : L('no instructor', 'من غير مدرب')}</span>
                {g.status !== 'ACTIVE' && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">{L('Finished', 'خلص')}</span>}
                {g.status === 'ACTIVE' && !g.started && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700">{L('Not started', 'لسه مابدأش')}</span>}
                {can('class_sections', 'delete') && <button type="button" className="ms-auto text-slate-400 hover:text-rose-600" title={L('Remove group', 'شيل الجروب')} onClick={() => confirm(L(`Remove the group ${g.name}?`, `تشيل الجروب ${g.name}؟`)) && delGroup.mutate(g.id)}><Trash2 className="h-4 w-4" /></button>}
              </li>
            ))}
            {!data.groups.length && <li className="px-3 py-3 text-xs text-slate-500">{L('No groups.', 'مفيش جروبات.')}</li>}
          </ul>
        </div>
      )}

      {tab === 'students' && data && (
        <div className="space-y-2">
          {can('students', 'create') && target && <Link href={`/dashboard/students/admission?campusId=${target}`}><Button size="sm" variant="outline"><Plus className="me-1 h-4 w-4" />{L('New admission', 'تسجيل طالب جديد')}</Button></Link>}
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {data.students.filter((s) => match(`${s.name} ${s.registrationNumber}`)).slice(0, 300).map((s) => (
              <li key={s.id} className={`flex flex-wrap items-center gap-2 px-3 py-2 ${s.isActive ? '' : 'opacity-60'}`}>
                <Link href={`/dashboard/students/${s.id}`} className="font-medium text-indigo-700 hover:underline">{s.name}</Link>
                <span className="text-xs text-slate-500">{s.registrationNumber}{places.length > 1 ? ` · ${s.campus.name}` : ''}</span>
                {s.groups.map((g) => (
                  <span key={g.enrollmentId} className="flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs">
                    <Link href={`/dashboard/groups?group=${g.id}`} className="hover:underline">{g.name}</Link>
                    {can('class_sections', 'update') && <button type="button" className="text-slate-400 hover:text-rose-600" title={L('Take out of this group', 'شيله من الجروب ده')} onClick={() => confirm(L(`Take ${s.name} out of ${g.name}?`, `تشيل ${s.name} من ${g.name}؟`)) && outOfGroup.mutate(g.enrollmentId)}><UserMinus className="h-3.5 w-3.5" /></button>}
                  </span>
                ))}
                {!s.groups.length && <span className="text-xs text-amber-600">{L('in no group', 'مش في جروب')}</span>}
              </li>
            ))}
            {!data.students.length && <li className="px-3 py-3 text-xs text-slate-500">{L('No students.', 'مفيش طلاب.')}</li>}
          </ul>
        </div>
      )}

      {tab === 'instructors' && data && (
        <div className="space-y-2">
          {can('teachers', 'update') && target && (
            <div className="flex flex-wrap items-center gap-2">
              <select className="h-8 min-w-[14rem] rounded-md border border-slate-200 bg-white px-2 text-xs" value={pick} onChange={(e) => setPick(e.target.value)}>
                <option value="">{L('Choose an instructor to add to this place', 'اختار مدرب تضيفه للمكان ده')}</option>
                {addable.map((t) => <option key={t.id} value={t.id}>{t.name} — {t.primary}</option>)}
              </select>
              <Button size="sm" variant="outline" disabled={!pick || addTeacher.isPending} onClick={() => addTeacher.mutate()}><Plus className="me-1 h-4 w-4" />{L('Add', 'ضيف')}</Button>
              {can('teachers', 'create') && <Link href="/dashboard/teachers/new"><Button size="sm" variant="ghost">{L('New instructor', 'مدرب جديد')}</Button></Link>}
              {places.length > 1 && !place && <span className="text-xs text-slate-500">{L('Adds to:', 'هيتضاف لـ:')} {places[0].name}</span>}
            </div>
          )}
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {data.instructors.filter((t) => match(t.name)).map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                <Link href={`/dashboard/teachers/${t.id}`} className="font-medium text-indigo-700 hover:underline">{t.name}</Link>
                <span className="text-xs text-slate-500">{t.phone ?? ''} · {L('main place', 'مكانه الأساسي')}: {t.primary.name}{t.allPlaces ? ` · ${L('every place', 'كل الأماكن')}` : ''}</span>
                <span className="text-xs text-slate-600">· {t.groups} {L('groups here', 'جروب هنا')}</span>
                {can('teachers', 'update') && !t.allPlaces && t.primary.id !== target && t.places.includes(target) && (
                  <button type="button" className="ms-auto text-slate-400 hover:text-rose-600" title={L('Remove from this place', 'شيله من المكان ده')} onClick={() => confirm(L(`Remove ${t.name} from this place?`, `تشيل ${t.name} من المكان ده؟`)) && removeTeacher.mutate(t.id)}><Trash2 className="h-4 w-4" /></button>
                )}
              </li>
            ))}
            {!data.instructors.length && <li className="px-3 py-3 text-xs text-slate-500">{L('No instructors.', 'مفيش مدربين.')}</li>}
          </ul>
        </div>
      )}
    </div>
  )
}
