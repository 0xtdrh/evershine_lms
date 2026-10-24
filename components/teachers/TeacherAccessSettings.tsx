'use client'

/** 2026-10-24 (owner): how long an instructor still sees a finished group and its students (Super Admin / Admin). */

import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { L } from '@/lib/i18n/client'

export function TeacherAccessSettings() {
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['teacher-access-settings'], queryFn: () => fetchApi<{ finishedGroupDays: number }>('/api/teachers/access/settings') })
  const [days, setDays] = useState('')
  useEffect(() => { if (data) setDays(String(data.finishedGroupDays)) }, [data])
  const save = useMutation({
    mutationFn: () => fetchApi('/api/teachers/access/settings', { method: 'PUT', body: JSON.stringify({ finishedGroupDays: Number(days) }) }),
    onSuccess: () => { notify.success(L('Saved', 'اتحفظ')); qc.invalidateQueries({ queryKey: ['teacher-access-settings'] }) },
    onError: (e: Error) => notify.error(e.message),
  })
  if (!data) return null
  return (
    <div id="access" className="rounded-2xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
      <p className="font-semibold text-slate-800">{L('What instructors see', 'المدرب بيشوف إيه')}</p>
      <p className="mt-1 text-xs text-slate-500">{L('Instructors see only the students of their own groups and never invoices. After a group finishes, its instructor still sees it for:', 'المدرب بيشوف طلاب جروباته بس ومن غير فواتير. ولما الجروب يخلص، المدرب بيفضل شايفه (علشان الدرجات النهائية والواجبات المتأخرة) لمدة:')}</p>
      <div className="mt-2 flex items-center gap-2">
        <Input type="number" min={0} max={365} className="h-9 w-24" value={days} onChange={(e) => setDays(e.target.value)} />
        <span className="text-slate-600">{L('days', 'يوم')}</span>
        <Button size="sm" disabled={save.isPending || days === '' || Number(days) === data.finishedGroupDays} onClick={() => save.mutate()}>{L('Save', 'احفظ')}</Button>
      </div>
    </div>
  )
}
