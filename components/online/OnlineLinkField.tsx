'use client'

/**
 * L5: the group's online class link (attendance screens; instructor / managers — hidden for secretaries).
 * a02 M1 batch 6: + a link for the chosen day only (e.g. the substitute's own room); it wins over the group link that day.
 */

import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { L } from '@/lib/i18n/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Video } from 'lucide-react'

export function OnlineLinkField({ groupId, date }: { groupId: string; date?: string }) {
  const qc = useQueryClient()
  const key = ['group-online', groupId, date ?? '']
  const { data, isError } = useQuery({ queryKey: key, queryFn: () => fetchApi<{ url: string | null; sessionUrl?: string | null }>(`/api/groups/${groupId}/online${date ? `?date=${date}` : ''}`), enabled: !!groupId, retry: false })
  const [url, setUrl] = useState('')
  const [dayUrl, setDayUrl] = useState('')
  useEffect(() => { setUrl(data?.url ?? ''); setDayUrl(data?.sessionUrl ?? '') }, [data])
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => fetchApi(`/api/groups/${groupId}/online`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: () => { notify.success(L('Saved', 'اتحفظ')); qc.invalidateQueries({ queryKey: ['group-online', groupId] }) },
    onError: (e: Error) => notify.error(e.message),
  })
  if (!groupId || isError || !data) return null
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 text-sm">
      <Video className="h-4 w-4 text-indigo-600" />
      <span className="font-medium text-slate-700">{L('Online class link', 'لينك الحصة الأونلاين')}</span>
      <Input className="h-8 min-w-[16rem] flex-1" placeholder="https://zoom.us/j/… / https://meet.google.com/…" value={url} onChange={(e) => setUrl(e.target.value)} />
      <Button size="sm" variant="outline" disabled={save.isPending || url === (data.url ?? '')} onClick={() => save.mutate({ url })}>{L('Save', 'حفظ')}</Button>
      {date && (
        <div className="flex w-full flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-slate-600">{L(`Link for ${date} only`, `لينك يوم ${date} بس`)}</span>
          <Input className="h-8 min-w-[14rem] flex-1" placeholder={L('empty = the group link', 'فاضي = لينك الجروب')} value={dayUrl} onChange={(e) => setDayUrl(e.target.value)} />
          <Button size="sm" variant="outline" disabled={save.isPending || dayUrl === (data.sessionUrl ?? '')} onClick={() => save.mutate({ date, sessionUrl: dayUrl })}>{L('Save', 'حفظ')}</Button>
        </div>
      )}
      <span className="w-full text-xs text-slate-400">{L('Students see a "Join" button 10 minutes before each online session; who joined shows next to their name here. A link for one day (e.g. a substitute\'s room) is used that day instead of the group link.', 'الطلبة بيشوفوا زرار «ادخل الحصة» قبل كل حصة أونلاين بـ 10 دقايق، واللي دخل بيظهر جنب اسمه هنا. لينك اليوم (مثلاً أوضة المدرب البديل) بيتستخدم اليوم ده بدل لينك الجروب.')}</span>
    </div>
  )
}
