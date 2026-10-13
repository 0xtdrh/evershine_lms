'use client'

/**
 * M0: the places of one staff account — primary place (from the profile), extra places, single groups (e.g. covering
 * the Thursday groups of another place) or every place. Super Admin (users:update).
 */

import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi, fetchPaginatedApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { L } from '@/lib/i18n/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { MapPin } from 'lucide-react'

interface Access { allLocations: boolean; primary: string | null; campusIds: string[]; groupIds: string[] }
interface Campus { id: string; name: string; kind?: string }
interface Group { id: string; label: string; campus: { id: string; name: string } }

export function AccountPlacesCard({ userId, name }: { userId: string; name: string }) {
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['user-places', userId], queryFn: () => fetchApi<Access>(`/api/users/${userId}/places`), retry: false })
  const { data: campuses } = useQuery({ queryKey: ['campuses-all'], queryFn: () => fetchPaginatedApi<Campus>('/api/campuses?limit=100') })
  const { data: groups } = useQuery({ queryKey: ['groups-all-places'], queryFn: () => fetchApi<Group[]>('/api/groups') })
  const [a, setA] = useState<Access | null>(null)
  const [q, setQ] = useState('')
  useEffect(() => { if (data) setA(data) }, [data])
  const save = useMutation({
    mutationFn: () => fetchApi(`/api/users/${userId}/places`, { method: 'PUT', body: JSON.stringify({ allLocations: a!.allLocations, campusIds: a!.campusIds, groupIds: a!.groupIds }) }),
    onSuccess: () => { notify.success(L('Saved', 'اتحفظ')); qc.invalidateQueries({ queryKey: ['user-places', userId] }) },
    onError: (e: Error) => notify.error(e.message),
  })
  const places = campuses?.data ?? []
  const outside = useMemo(() => (groups ?? []).filter((g) => g.campus.id !== a?.primary && !a?.campusIds.includes(g.campus.id)), [groups, a])
  if (!a) return null
  const toggle = (list: 'campusIds' | 'groupIds', id: string) => setA({ ...a, [list]: a[list].includes(id) ? a[list].filter((x) => x !== id) : [...a[list], id] })
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base"><MapPin className="h-4 w-4 text-indigo-600" /> {L('Places of', 'أماكن')} {name}</CardTitle>
        <CardDescription>{L('What this account sees. The primary place comes from the profile.', 'الحساب ده يشوف إيه. المكان الأساسي جاي من ملفه.')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p>{L('Primary place', 'المكان الأساسي')}: <b>{places.find((c) => c.id === a.primary)?.name ?? L('none', 'مفيش')}</b></p>
        <label className="flex items-center gap-2 font-medium"><input type="checkbox" checked={a.allLocations} onChange={(e) => setA({ ...a, allLocations: e.target.checked })} /> {L('Every place', 'كل الأماكن')}</label>
        {!a.allLocations && (
          <>
            <div>
              <p className="mb-1 text-xs text-slate-500">{L('Extra places (all their groups and students)', 'أماكن إضافية (كل جروباتها وطلبتها)')}</p>
              <div className="flex flex-wrap gap-3">{places.filter((c) => c.id !== a.primary).map((c) => (
                <label key={c.id} className="flex items-center gap-1 text-xs"><input type="checkbox" checked={a.campusIds.includes(c.id)} onChange={() => toggle('campusIds', c.id)} /> {c.name}{c.kind === 'PARTNER' ? ' 🤝' : ''}</label>
              ))}</div>
            </div>
            <div>
              <p className="mb-1 text-xs text-slate-500">{L('Single groups in other places (only those groups and their students)', 'جروبات معيّنة في أماكن تانية (الجروبات دي وطلبتها بس)')}</p>
              <Input className="mb-1 h-8" placeholder={L('Search a group', 'دوّر على جروب')} value={q} onChange={(e) => setQ(e.target.value)} />
              <div className="max-h-48 space-y-1 overflow-y-auto rounded border border-slate-100 p-2">
                {outside.filter((g) => !q || `${g.label} ${g.campus.name}`.toLowerCase().includes(q.toLowerCase())).slice(0, 80).map((g) => (
                  <label key={g.id} className="flex items-center gap-2 text-xs"><input type="checkbox" checked={a.groupIds.includes(g.id)} onChange={() => toggle('groupIds', g.id)} /> {g.label} <span className="text-slate-400">· {g.campus.name}</span></label>
                ))}
                {!outside.length && <p className="text-xs text-slate-400">—</p>}
              </div>
            </div>
          </>
        )}
        <Button size="sm" disabled={save.isPending} onClick={() => save.mutate()}>{L('Save places', 'احفظ الأماكن')}</Button>
      </CardContent>
    </Card>
  )
}
