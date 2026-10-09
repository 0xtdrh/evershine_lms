'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { Card, CardContent } from '@/components/ui/card'
import { Megaphone } from 'lucide-react'

/** Staff-only: "do not use this child in marketing" (exception agreed offline with the parent). */
export function StudentMarketingFlag({ studentId, canEdit }: { studentId: string; canEdit: boolean }) {
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['student-marketing', studentId], queryFn: () => fetchApi<{ noMarketing: boolean }>(`/api/students/${studentId}/marketing`) })
  const save = useMutation({
    mutationFn: (noMarketing: boolean) => fetchApi(`/api/students/${studentId}/marketing`, { method: 'PUT', body: JSON.stringify({ noMarketing }) }),
    onSuccess: () => { notify.success('Saved'); qc.invalidateQueries({ queryKey: ['student-marketing', studentId] }) },
    onError: (e: Error) => notify.error(e.message),
  })
  if (!data) return null
  return (
    <Card className={data.noMarketing ? 'border-rose-200' : ''}>
      <CardContent className="flex flex-wrap items-center justify-between gap-2 pt-4 text-sm">
        <span className="flex items-center gap-2"><Megaphone className="h-4 w-4 text-rose-600" /> Do not use this student in marketing <span className="text-xs text-slate-400">(staff only — exception agreed with the parent)</span></span>
        <input type="checkbox" className="h-5 w-5 accent-rose-600" checked={data.noMarketing} disabled={!canEdit || save.isPending} onChange={(e) => save.mutate(e.target.checked)} />
      </CardContent>
    </Card>
  )
}
