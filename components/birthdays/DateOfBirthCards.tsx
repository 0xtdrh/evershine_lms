'use client'

import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Cake } from 'lucide-react'
import { L } from '@/lib/i18n/client'
import { DateInput } from '@/components/ui/date-input'

function DobRow({ label, value, onSave, saving }: { label: string; value: string | null; onSave: (v: string | null) => void; saving: boolean }) {
  const [v, setV] = useState(value ?? '')
  useEffect(() => setV(value ?? ''), [value])
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="min-w-[140px] font-medium text-slate-700">{label}</span>
      <DateInput className="h-8 w-44" value={v} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setV(e.target.value)} />
      <Button size="sm" variant="outline" className="h-8" disabled={saving || v === (value ?? '')} onClick={() => onSave(v || null)}>{L('Save', 'حفظ')}</Button>
    </div>
  )
}

/** Settings: your own date of birth (parents and staff; students/instructors use their record). */
export function MyDateOfBirthCard() {
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['my-dob'], queryFn: () => fetchApi<{ dateOfBirth: string | null }>('/api/users/date-of-birth') })
  const save = useMutation({
    mutationFn: (dateOfBirth: string | null) => fetchApi('/api/users/date-of-birth', { method: 'PUT', body: JSON.stringify({ dateOfBirth }) }),
    onSuccess: () => { notify.success(L('Saved', 'اتحفظ')); qc.invalidateQueries({ queryKey: ['my-dob'] }) },
    onError: (e: Error) => notify.error(e.message),
  })
  return (
    <Card className="rounded-xl border bg-white shadow-sm">
      <CardHeader className="border-b bg-gray-50/50 py-4">
        <CardTitle className="flex items-center gap-2 text-sm font-bold text-gray-900"><Cake className="h-4 w-4 text-pink-600" /> {L('Date of birth', 'تاريخ الميلاد')}</CardTitle>
        <CardDescription className="text-xs">{L('Optional — so we can wish you a happy birthday 🎂', 'اختياري — علشان نقولك كل سنة وانت طيب 🎂')}</CardDescription>
      </CardHeader>
      <CardContent className="pt-4"><DobRow label={L('Your birthday', 'عيد ميلادك')} value={data?.dateOfBirth ?? null} saving={save.isPending} onSave={(v) => save.mutate(v)} /></CardContent>
    </Card>
  )
}

/** Student page: the parents' dates of birth (staff). */
export function GuardianBirthdaysCard({ guardians, canEdit }: { guardians: { id: string; firstName: string; lastName: string }[]; canEdit: boolean }) {
  const qc = useQueryClient()
  const ids = guardians.map((g) => g.id).join(',')
  const { data } = useQuery({ queryKey: ['guardian-dobs', ids], queryFn: () => fetchApi<Record<string, string | null>>(`/api/users/date-of-birth?guardianIds=${ids}`), enabled: !!ids })
  const save = useMutation({
    mutationFn: (p: { guardianId: string; dateOfBirth: string | null }) => fetchApi('/api/users/date-of-birth', { method: 'PUT', body: JSON.stringify(p) }),
    onSuccess: () => { notify.success(L('Saved', 'اتحفظ')); qc.invalidateQueries({ queryKey: ['guardian-dobs', ids] }) },
    onError: (e: Error) => notify.error(e.message),
  })
  if (!guardians.length) return null
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm"><Cake className="h-4 w-4 text-pink-600" /> Parents&apos; birthdays</CardTitle>
        <CardDescription>{L('Optional. Parents with a date here are greeted on their birthday.', 'اختياري. أولياء الأمور اللي ليهم تاريخ هنا بيتهنّوا في عيد ميلادهم.')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {guardians.map((g) => canEdit
          ? <DobRow key={g.id} label={`${g.firstName} ${g.lastName}`.trim()} value={data?.[g.id] ?? null} saving={save.isPending} onSave={(v) => save.mutate({ guardianId: g.id, dateOfBirth: v })} />
          : <p key={g.id} className="text-sm">{g.firstName} {g.lastName}: {data?.[g.id] ?? '—'}</p>)}
      </CardContent>
    </Card>
  )
}
