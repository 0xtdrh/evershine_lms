'use client'

/** P2: thank-you notes and older students' project uploads waiting for the instructor / managers. */

import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { L, useI18n } from '@/lib/i18n/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { CheckCircle2, Loader2 } from 'lucide-react'

type Media = { url: string; type: 'image' | 'video' } | null
interface Data { thanks: { id: string; from: string; to: string; text: string }[]; uploads: { id: string; student: string; title: string; description: string | null; media: Media }[] }

export default function ProfileApprovalsPage() {
  const { dir } = useI18n()
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['profile-approvals'], queryFn: () => fetchApi<Data>('/api/profile/approvals') })
  const decide = useMutation({
    mutationFn: (b: { what: 'THANKS' | 'UPLOAD'; id: string; approve: boolean }) => fetchApi('/api/profile/approvals', { method: 'POST', body: JSON.stringify(b) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['profile-approvals'] }), onError: (e: Error) => notify.error(e.message),
  })
  const btns = (what: 'THANKS' | 'UPLOAD', id: string) => (
    <div className="flex gap-2"><Button size="sm" onClick={() => decide.mutate({ what, id, approve: true })}>{L('Approve', 'موافقة')}</Button><Button size="sm" variant="outline" onClick={() => decide.mutate({ what, id, approve: false })}>{L('Refuse', 'رفض')}</Button></div>
  )
  return (
    <div className="space-y-4" dir={dir}>
      <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900"><CheckCircle2 className="h-7 w-7 text-indigo-600" /> {L('Profile approvals', 'موافقات البروفايل')}</h1>
      {isLoading ? <Loader2 className="h-5 w-5 animate-spin text-slate-400" /> : (
        <>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">🤝 {L('Thank-you notes', 'رسايل الشكر')} ({data?.thanks.length ?? 0})</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              {!data?.thanks.length ? <p className="text-slate-500">{L('Nothing waiting.', 'مفيش حاجة مستنية.')}</p> : data.thanks.map((t) => (
                <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 p-2"><span><b>{t.from}</b> → <b>{t.to}</b>: “{t.text}”</span>{btns('THANKS', t.id)}</div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">🖼️ {L('Student uploads', 'رفع الطلبة')} ({data?.uploads.length ?? 0})</CardTitle></CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {!data?.uploads.length ? <p className="text-sm text-slate-500">{L('Nothing waiting.', 'مفيش حاجة مستنية.')}</p> : data.uploads.map((u) => (
                <div key={u.id} className="space-y-2 rounded-xl border border-slate-100 p-2 text-sm">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {u.media && (u.media.type === 'video' ? <video src={u.media.url} controls className="h-40 w-full rounded bg-black" /> : <img src={u.media.url} alt="" className="h-40 w-full rounded object-cover" />)}
                  <p><b>{u.student}</b>: {u.title}</p>{u.description && <p className="text-xs text-slate-500">{u.description}</p>}
                  {btns('UPLOAD', u.id)}
                </div>
              ))}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
