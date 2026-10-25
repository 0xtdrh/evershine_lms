'use client'

/**
 * 5-D: the sender / approver side — sent announcements with their reach (read / confirmed), the ones waiting for
 * approval, one announcement's recipients (follow up who did not read), and the announcement settings.
 */

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { L, useI18n } from '@/lib/i18n/client'
import { AUDIENCE_LABEL, SCOPE_LABEL, type Audience, type ScopeType } from '@/lib/announcements/rules'
import { CheckCircle2, Loader2, Pin, PhoneCall, XCircle } from 'lucide-react'

interface Row {
  id: string; title: string; titleAr: string | null; status: string; isActive: boolean; pinned: boolean; requireAck: boolean
  audiences: Audience[]; scopeType: ScopeType | null; scopeCount: number; publishedAt: string; expiresAt: string | null
  delivered: boolean; rejectedReason: string | null; sender: string; mine: boolean; total: number; read: number; acked: number
}
interface Detail {
  announcement: { id: string; title: string; titleAr: string | null; body: string | null; content: string; contentAr: string | null; requireAck: boolean }
  reach: { total: number; read: number; acked: number; readPct: number; ackPct: number | null }
  recipients: { userId: string; name: string; phone: string | null; kind: Audience; student: string | null; readAt: string | null; ackAt: string | null }[]
}

const STATUS: Record<string, [string, string, string]> = {
  PUBLISHED: ['Published', 'منشور', 'bg-emerald-50 text-emerald-700 border-emerald-200'],
  PENDING: ['Waiting approval', 'مستني موافقة', 'bg-amber-50 text-amber-700 border-amber-200'],
  REJECTED: ['Not approved', 'ماتوافقش عليه', 'bg-rose-50 text-rose-700 border-rose-200'],
}

export function AnnouncementList({ tab, canApprove }: { tab: 'sent' | 'pending'; canApprove: boolean }) {
  const ar = useI18n().locale === 'ar'
  const qc = useQueryClient()
  const [open, setOpen] = useState<string | null>(null)
  const { data, isLoading } = useQuery({ queryKey: ['announcements-manage', tab], queryFn: () => fetchApi<Row[]>(`/api/announcements?mode=manage&tab=${tab}`) })
  const act = useMutation({
    mutationFn: ({ id, action, reason }: { id: string; action: string; reason?: string }) => fetchApi(`/api/announcements/${id}`, { method: 'PATCH', body: JSON.stringify({ action, reason }) }),
    onSuccess: () => { notify.success(L('Done', 'تم')); qc.invalidateQueries({ queryKey: ['announcements-manage'] }); qc.invalidateQueries({ queryKey: ['today-tasks'] }) },
    onError: (e: Error) => notify.error(e.message),
  })
  if (isLoading) return <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
  const rows = data ?? []
  if (!rows.length) return <p className="py-8 text-center text-sm text-slate-500">{tab === 'pending' ? L('Nothing waiting for approval.', 'مفيش حاجة مستنية موافقة.') : L('No announcements sent yet.', 'لسه مفيش إعلانات اتبعتت.')}</p>
  return (
    <div className="space-y-2">
      {rows.map((r) => {
        const st = STATUS[r.status] ?? STATUS.PUBLISHED
        const who = r.audiences.map((a) => (ar ? AUDIENCE_LABEL[a][1] : AUDIENCE_LABEL[a][0])).join('، ')
        const where = r.scopeType ? `${ar ? SCOPE_LABEL[r.scopeType][1] : SCOPE_LABEL[r.scopeType][0]}${r.scopeCount ? ` (${r.scopeCount})` : ''}` : ''
        return (
          <div key={r.id} className={`rounded-lg border p-3 text-sm ${r.isActive ? 'border-slate-200' : 'border-slate-200 opacity-60'}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <button type="button" className="flex items-center gap-1.5 text-start font-semibold text-slate-900 hover:underline" onClick={() => setOpen(r.id)}>
                {r.pinned && <Pin className="h-3.5 w-3.5 text-indigo-600" />}{(ar && r.titleAr) || r.title}
              </button>
              <span className="flex items-center gap-1.5">
                {!r.isActive && <span className="rounded-full border px-2 py-0.5 text-xs text-slate-500">{L('Stopped', 'اتوقف')}</span>}
                {r.status === 'PUBLISHED' && !r.delivered && <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-xs text-sky-700">{L('Scheduled', 'متجدول')}</span>}
                <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${st[2]}`}>{ar ? st[1] : st[0]}</span>
              </span>
            </div>
            <p className="mt-0.5 text-xs text-slate-500">{who} · {where} · {r.sender} · {new Date(r.publishedAt).toLocaleString(ar ? 'ar-EG-u-nu-latn' : 'en-GB', { dateStyle: 'short', timeStyle: 'short' })}</p>
            {r.status === 'PUBLISHED' && r.delivered && (
              <p className="mt-1 text-xs text-slate-600">
                {L('Reached', 'وصل لـ')} <b>{r.total}</b> · {L('read', 'قرأ')} <b>{r.read}</b>{r.requireAck && <> · {L('confirmed', 'أكّد')} <b>{r.acked}</b></>}
              </p>
            )}
            {r.rejectedReason && <p className="mt-1 text-xs text-rose-700">{r.rejectedReason}</p>}
            <div className="mt-2 flex flex-wrap gap-2">
              {tab === 'pending' && canApprove && !r.mine && (
                <>
                  <Button size="sm" className="h-7 gap-1 bg-emerald-600 text-xs hover:bg-emerald-700" disabled={act.isPending} onClick={() => act.mutate({ id: r.id, action: 'approve' })}><CheckCircle2 className="h-3.5 w-3.5" />{L('Approve & send', 'وافق وابعت')}</Button>
                  <Button size="sm" variant="outline" className="h-7 gap-1 text-xs text-rose-600" disabled={act.isPending}
                    onClick={() => { const reason = window.prompt(L('Why not? (the sender sees it)', 'ليه لأ؟ (صاحب الإعلان هيشوف السبب)')) ?? ''; act.mutate({ id: r.id, action: 'reject', reason }) }}>
                    <XCircle className="h-3.5 w-3.5" />{L('Not approve', 'مش موافق')}
                  </Button>
                </>
              )}
              {tab === 'sent' && r.isActive && (
                <>
                  {canApprove && <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => act.mutate({ id: r.id, action: r.pinned ? 'unpin' : 'pin' })}>{r.pinned ? L('Unpin', 'شيل التثبيت') : L('Pin', 'ثبّت')}</Button>}
                  <Button size="sm" variant="ghost" className="h-7 text-xs text-rose-600" onClick={() => { if (window.confirm(L('Stop showing this announcement?', 'توقف عرض الإعلان ده؟'))) act.mutate({ id: r.id, action: 'stop' }) }}>{L('Stop', 'وقّف')}</Button>
                </>
              )}
            </div>
          </div>
        )
      })}
      <Dialog open={!!open} onOpenChange={(o) => { if (!o) setOpen(null) }}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader><DialogTitle>{L('Announcement', 'الإعلان')}</DialogTitle></DialogHeader>
          {open && <AnnouncementDetail id={open} />}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function AnnouncementDetail({ id }: { id: string }) {
  const ar = useI18n().locale === 'ar'
  const [only, setOnly] = useState(false)
  const { data } = useQuery({ queryKey: ['announcement-detail', id], queryFn: () => fetchApi<Detail>(`/api/announcements/${id}`) })
  const follow = useMutation({
    mutationFn: () => fetchApi<{ added: number }>(`/api/announcements/${id}/follow-up`, { method: 'POST' }),
    onSuccess: (r) => notify.success(L(`${r.added} follow-ups added (Follow-ups page)`, `اتضاف ${r.added} متابعة (صفحة المتابعات)`)),
    onError: (e: Error) => notify.error(e.message),
  })
  if (!data) return <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
  const a = data.announcement
  const open = (r: Detail['recipients'][number]) => (a.requireAck ? !r.ackAt : !r.readAt)
  const list = only ? data.recipients.filter(open) : data.recipients
  const day = (d: string | null) => (d ? new Date(d).toLocaleString(ar ? 'ar-EG-u-nu-latn' : 'en-GB', { dateStyle: 'short', timeStyle: 'short' }) : '—')
  return (
    <div className="space-y-3 text-sm">
      <div className="rounded-lg bg-slate-50 p-3">
        <p className="font-semibold">{(ar && a.titleAr) || a.title}</p>
        <p className="mt-1 whitespace-pre-wrap text-slate-700">{(ar && a.contentAr) || a.body || a.content}</p>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg border p-2"><p className="text-xl font-bold">{data.reach.total}</p><p className="text-xs text-slate-500">{L('reached', 'وصلهم')}</p></div>
        <div className="rounded-lg border p-2"><p className="text-xl font-bold">{data.reach.readPct}%</p><p className="text-xs text-slate-500">{L('read', 'قروا')}</p></div>
        <div className="rounded-lg border p-2"><p className="text-xl font-bold">{data.reach.ackPct == null ? '—' : `${data.reach.ackPct}%`}</p><p className="text-xs text-slate-500">{L('confirmed', 'أكّدوا')}</p></div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={only} onChange={(e) => setOnly(e.target.checked)} />{a.requireAck ? L('Only who did not confirm', 'اللي ماأكّدوش بس') : L('Only who did not read', 'اللي ماقروش بس')}</label>
        <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" disabled={follow.isPending} onClick={() => follow.mutate()}><PhoneCall className="h-3.5 w-3.5" />{L('Call follow-up for parents who did not', 'متابعة بالتليفون لأولياء الأمور اللي لأ')}</Button>
      </div>
      <div className="max-h-80 overflow-y-auto rounded-lg border">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-slate-500"><tr><th className="p-2 text-start">{L('Name', 'الاسم')}</th><th className="p-2 text-start">{L('For', 'بخصوص')}</th><th className="p-2 text-start">{L('Read', 'قرأ')}</th>{a.requireAck && <th className="p-2 text-start">{L('Confirmed', 'أكّد')}</th>}</tr></thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.userId} className="border-t">
                <td className="p-2">{r.name}<span className="text-slate-400"> · {ar ? AUDIENCE_LABEL[r.kind][1] : AUDIENCE_LABEL[r.kind][0]}</span>
                  {r.phone && open(r) && <a className="ms-1 text-emerald-700 hover:underline" href={`https://wa.me/2${r.phone.replace(/^\+?2?/, '')}`} target="_blank" rel="noopener noreferrer">WhatsApp</a>}
                </td>
                <td className="p-2">{r.student ?? '—'}</td>
                <td className="p-2">{day(r.readAt)}</td>
                {a.requireAck && <td className="p-2">{day(r.ackAt)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function AnnouncementSettingsCard() {
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['announcement-settings'], queryFn: () => fetchApi<{ teachersCanSend: boolean; defaultRequireAck: boolean }>('/api/announcements/settings') })
  const save = useMutation({
    mutationFn: (v: Partial<{ teachersCanSend: boolean; defaultRequireAck: boolean }>) => fetchApi('/api/announcements/settings', { method: 'PUT', body: JSON.stringify(v) }),
    onSuccess: () => { notify.success(L('Saved', 'اتحفظ')); qc.invalidateQueries({ queryKey: ['announcement-settings'] }); qc.invalidateQueries({ queryKey: ['announcement-options'] }) },
    onError: (e: Error) => notify.error(e.message),
  })
  if (!data) return <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
  return (
    <div className="space-y-3 text-sm">
      <label className="flex items-center gap-2"><input type="checkbox" checked={data.teachersCanSend} onChange={(e) => save.mutate({ teachersCanSend: e.target.checked })} />{L('Instructors may send announcements to their own groups', 'المدرب يقدر يبعت إعلانات لجروباته')}</label>
      <label className="flex items-center gap-2"><input type="checkbox" checked={data.defaultRequireAck} onChange={(e) => save.mutate({ defaultRequireAck: e.target.checked })} />{L('New announcements ask "I read it" by default', 'الإعلان الجديد يطلب «قريته» افتراضيًا')}</label>
      <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
        {L('Who may send and who needs approval is set on the Permissions page (role, place or person): "Announcements → create" sends, and without "approve" the announcement waits for a manager.',
          'مين يقدر يبعت ومين محتاج موافقة بيتظبط من صفحة الصلاحيات (للدور أو المكان أو الشخص): «الإعلانات ← create» يبعت، ومن غير «approve» الإعلان يستنى موافقة المدير.')}
      </p>
    </div>
  )
}
