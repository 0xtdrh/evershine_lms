'use client'

/** Under a sent session report: the parent writes one reply, which reaches the follow-ups. */

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { L } from '@/lib/i18n/client'
import { Button } from '@/components/ui/button'

export function ReportReply({ reportId, studentId }: { reportId: string; studentId: string }) {
  const qc = useQueryClient()
  const [text, setText] = useState('')
  const send = useMutation({
    mutationFn: () => fetchApi(`/api/session-reports/${reportId}/reply`, { method: 'POST', body: JSON.stringify({ studentId, text }) }),
    onSuccess: () => { notify.success(L('Sent, thank you', 'اتبعت، شكرًا')); qc.invalidateQueries() },
    onError: (e: Error) => notify.error(e.message),
  })
  return (
    <div className="mt-3 space-y-2 print:hidden">
      <textarea className="min-h-[60px] w-full rounded-md border border-gray-300 p-2 text-sm" maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} placeholder={L('A question or a word for the instructor (optional)', 'سؤال أو كلمة للمدرب (اختياري)')} />
      <div className="flex justify-end"><Button size="sm" disabled={send.isPending || text.trim().length < 2} onClick={() => send.mutate()}>{L('Send', 'ابعت')}</Button></div>
    </div>
  )
}
