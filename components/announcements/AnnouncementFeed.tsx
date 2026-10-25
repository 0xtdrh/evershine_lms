'use client'

/**
 * 5-D: the reader's announcements (parents, students, instructors, staff). Pinned first; shown in the screen language
 * (Arabic copy when there is one). Opening the list marks them read; important ones need "I read it".
 */

import { useEffect, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { Button } from '@/components/ui/button'
import { L, useI18n } from '@/lib/i18n/client'
import { CheckCircle2, Loader2, Megaphone, Paperclip, Pin } from 'lucide-react'

export interface FeedItem {
  id: string; title: string; titleAr: string | null; body: string; contentAr: string | null
  attachmentUrl: string | null; attachmentName: string | null; pinned: boolean; requireAck: boolean
  publishedAt: string; readAt: string | null; ackAt: string | null; legacy: boolean
}

export function AnnouncementFeed({ compact }: { compact?: boolean }) {
  const ar = useI18n().locale === 'ar'
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['announcement-feed'], queryFn: () => fetchApi<FeedItem[]>('/api/announcements') })
  const read = useMutation({
    mutationFn: ({ id, ack }: { id: string; ack: boolean }) => fetchApi(`/api/announcements/${id}/read`, { method: 'POST', body: JSON.stringify({ ack }) }),
    onSuccess: (_r, v) => {
      if (v.ack) notify.success(L('Thank you — confirmed', 'شكرًا — اتأكد'))
      qc.invalidateQueries({ queryKey: ['announcement-feed'] })
      qc.invalidateQueries({ queryKey: ['today-tasks'] })
    },
  })
  // seeing the list = read (once per item)
  const marked = useRef(new Set<string>())
  useEffect(() => {
    // the small box (home page) shows only the important ones: only those count as read there
    for (const a of (data ?? []).filter((x) => !compact || (x.requireAck && !x.ackAt))) {
      if (!a.legacy && !a.readAt && !marked.current.has(a.id)) { marked.current.add(a.id); read.mutate({ id: a.id, ack: false }) }
    }
  }, [data, compact]) // eslint-disable-line react-hooks/exhaustive-deps

  if (isLoading) return <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />{L('Loading…', 'بيحمّل…')}</p>
  const items = compact ? (data ?? []).filter((a) => a.requireAck && !a.ackAt) : data ?? []
  if (!items.length) return compact ? null : <p className="py-8 text-center text-sm text-slate-500">{L('No announcements.', 'مفيش إعلانات.')}</p>
  return (
    <div className="space-y-3">
      {items.map((a) => {
        const title = (ar && a.titleAr) || a.title
        const text = (ar && a.contentAr) || a.body
        const mustAck = a.requireAck && !a.ackAt
        return (
          <div key={a.id} className={`rounded-xl border p-4 ${mustAck ? 'border-amber-300 bg-amber-50' : a.pinned ? 'border-indigo-200 bg-indigo-50/40' : 'border-slate-200 bg-white'}`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="flex items-center gap-2 font-semibold text-slate-900">
                {a.pinned ? <Pin className="h-4 w-4 text-indigo-600" /> : <Megaphone className="h-4 w-4 text-indigo-600" />}{title}
              </p>
              <span className="text-xs text-slate-400">{new Date(a.publishedAt).toLocaleDateString(ar ? 'ar-EG-u-nu-latn' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
            </div>
            <p className="mt-1.5 whitespace-pre-wrap text-sm text-slate-700">{text}</p>
            {a.attachmentUrl && (
              <a href={a.attachmentUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-indigo-700 hover:underline">
                <Paperclip className="h-4 w-4" />{a.attachmentName || L('Attachment', 'مرفق')}
              </a>
            )}
            {a.requireAck && (
              <div className="mt-3">
                {a.ackAt
                  ? <p className="flex items-center gap-1 text-xs font-medium text-emerald-700"><CheckCircle2 className="h-4 w-4" />{L('You confirmed you read it', 'أكدت إنك قريته')}</p>
                  : <Button size="sm" className="bg-amber-600 hover:bg-amber-700" disabled={read.isPending} onClick={() => read.mutate({ id: a.id, ack: true })}>{L('I read it', 'قريته وفهمته')}</Button>}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
