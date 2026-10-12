'use client'

/** L5: the group's online class link (attendance screens; instructor / managers — hidden for secretaries). */

import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { L } from '@/lib/i18n/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Video } from 'lucide-react'

export function OnlineLinkField({ groupId }: { groupId: string }) {
  const qc = useQueryClient()
  const { data, isError } = useQuery({ queryKey: ['group-online', groupId], queryFn: () => fetchApi<{ url: string | null }>(`/api/groups/${groupId}/online`), enabled: !!groupId, retry: false })
  const [url, setUrl] = useState('')
  useEffect(() => { setUrl(data?.url ?? '') }, [data])
  const save = useMutation({
    mutationFn: (v: string) => fetchApi(`/api/groups/${groupId}/online`, { method: 'PATCH', body: JSON.stringify({ url: v }) }),
    onSuccess: () => { notify.success(L('Saved', 'اتحفظ')); qc.invalidateQueries({ queryKey: ['group-online', groupId] }) },
    onError: (e: Error) => notify.error(e.message),
  })
  if (!groupId || isError || !data) return null
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 text-sm">
      <Video className="h-4 w-4 text-indigo-600" />
      <span className="font-medium text-slate-700">{L('Online class link', 'لينك الحصة الأونلاين')}</span>
      <Input className="h-8 min-w-[16rem] flex-1" placeholder="https://zoom.us/j/… / https://meet.google.com/…" value={url} onChange={(e) => setUrl(e.target.value)} />
      <Button size="sm" variant="outline" disabled={save.isPending || url === (data.url ?? '')} onClick={() => save.mutate(url)}>{L('Save', 'حفظ')}</Button>
      <span className="w-full text-xs text-slate-400">{L('Students see a "Join" button 15 minutes before each session; who joined shows next to their name here. Leave empty when the group is not online.', 'الطلبة بيشوفوا زرار «ادخل الحصة» قبل كل حصة بـ 15 دقيقة، واللي دخل بيظهر جنب اسمه هنا. سيبه فاضي لو الجروب مش أونلاين.')}</span>
    </div>
  )
}
