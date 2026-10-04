'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Check, Loader2, Lock, Send, Star, ThumbsDown, ThumbsUp } from 'lucide-react'

export const STATUS_STEPS = ['NEW', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'] as const
export const STATUS_LABEL: Record<string, string> = { NEW: 'New', IN_PROGRESS: 'Being handled', RESOLVED: 'Solved', CLOSED: 'Closed' }
export const KIND_LABEL: Record<string, string> = { COMPLAINT: 'Complaint', SUGGESTION: 'Suggestion', PRAISE: 'Thank you' }
export const TOPIC_LABEL: Record<string, string> = { INSTRUCTOR: 'Instructor', SCHEDULE: 'Schedule', PAYMENT: 'Payments', PLACE: 'Place', SESSION: 'Sessions', OTHER: 'Other' }

interface Detail {
  id: string; number: string | null; kind: string; topic: string | null; status: string; source: string; text: string
  sender: string; senderRole: string; student: { id: string; name: string; registrationNumber: string } | null; group: string | null
  assignedToId: string | null; dueAt: string | null; escalatedAt: string | null; satisfied: boolean | null; handlingRating: number | null; createdAt: string
  legacyRemarks: string | null
  replies: { id: string; body: string; internal: boolean; fromStaff: boolean; author: string; createdAt: string }[]
  handlers: { id: string; name: string }[]
  canHandle: boolean
}

const when = (d: string) => new Date(d).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })

/** Phase D: one complaint — stage tracker, conversation, actions (staff) or "solved?" (sender). */
export function ComplaintThread({ id, staff }: { id: string; staff: boolean }) {
  const qc = useQueryClient()
  const [reply, setReply] = useState('')
  const [internal, setInternal] = useState(false)
  const [stars, setStars] = useState(0)
  const { data: c, isLoading } = useQuery({ queryKey: ['complaint', id], queryFn: () => fetchApi<Detail>(`/api/complaints/${id}`) })
  const refresh = () => { qc.invalidateQueries({ queryKey: ['complaint', id] }); qc.invalidateQueries({ queryKey: ['complaints'] }) }
  const send = useMutation({
    mutationFn: () => fetchApi(`/api/complaints/${id}`, { method: 'POST', body: JSON.stringify({ body: reply, internal: staff && internal }) }),
    onSuccess: () => { setReply(''); setInternal(false); refresh() },
    onError: (e: Error) => notify.error(e.message),
  })
  const patch = useMutation({
    mutationFn: (body: { status?: string; assignedToId?: string | null }) => fetchApi(`/api/complaints/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: () => { notify.success('Saved'); refresh() },
    onError: (e: Error) => notify.error(e.message),
  })
  const confirm = useMutation({
    mutationFn: (satisfied: boolean) => fetchApi(`/api/complaints/${id}/confirm`, { method: 'POST', body: JSON.stringify({ satisfied, rating: stars || null }) }),
    onSuccess: (_r, satisfied) => { notify.success(satisfied ? 'Thank you!' : 'Sorry — we will follow up again'); refresh() },
    onError: (e: Error) => notify.error(e.message),
  })
  if (isLoading || !c) return <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
  const stepIdx = STATUS_STEPS.indexOf(c.status as (typeof STATUS_STEPS)[number])

  return (
    <div className="space-y-4 text-sm">
      <div>
        <p className="text-xs text-slate-500">{c.number} · {KIND_LABEL[c.kind] ?? c.kind}{c.topic ? ` · ${TOPIC_LABEL[c.topic] ?? c.topic}` : ''}{c.source === 'PHONE' ? ' · recorded by phone' : c.source === 'AUTO_RATING' ? ' · from a low rating' : ''}</p>
        <p className="font-semibold text-slate-800">{c.sender}{c.student ? ` · about ${c.student.name}` : ''}{c.group ? ` · ${c.group}` : ''}</p>
        {staff && c.escalatedAt && <p className="text-xs font-semibold text-rose-600">Escalated to the branch manager (no reply before the deadline)</p>}
      </div>

      {/* stage tracker */}
      <div className="flex items-center gap-1">
        {STATUS_STEPS.map((s, i) => (
          <div key={s} className="flex flex-1 items-center gap-1">
            <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${i <= stepIdx ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-500'}`}>{i < stepIdx ? <Check className="h-3.5 w-3.5" /> : i + 1}</div>
            <span className={`text-[11px] ${i <= stepIdx ? 'font-semibold text-indigo-700' : 'text-slate-400'}`}>{STATUS_LABEL[s]}</span>
            {i < STATUS_STEPS.length - 1 && <div className={`h-0.5 flex-1 ${i < stepIdx ? 'bg-indigo-600' : 'bg-slate-200'}`} />}
          </div>
        ))}
      </div>

      {/* conversation */}
      <div className="space-y-2">
        <div className="rounded-lg bg-slate-50 p-3">
          <p className="text-xs text-slate-500">{c.sender} · {when(c.createdAt)}</p>
          <p className="whitespace-pre-wrap text-slate-800">{c.text}</p>
        </div>
        {c.legacyRemarks && <div className="rounded-lg bg-indigo-50 p-3"><p className="text-xs text-indigo-600">TechNova team</p><p>{c.legacyRemarks}</p></div>}
        {c.replies.map((r) => (
          <div key={r.id} className={`rounded-lg p-3 ${r.internal ? 'border border-dashed border-amber-300 bg-amber-50' : r.fromStaff ? 'ml-6 bg-indigo-50' : 'mr-6 bg-slate-50'}`}>
            <p className="flex items-center gap-1 text-xs text-slate-500">{r.internal && <Lock className="h-3 w-3" />}{r.internal ? 'Internal note · ' : ''}{r.author} · {when(r.createdAt)}</p>
            <p className="whitespace-pre-wrap text-slate-800">{r.body}</p>
          </div>
        ))}
      </div>

      {/* sender: was it solved? */}
      {!staff && c.status === 'RESOLVED' && (
        <div className="space-y-2 rounded-lg border-2 border-emerald-200 bg-emerald-50 p-3">
          <p className="font-semibold text-emerald-800">Is the problem really solved?</p>
          <div className="flex items-center gap-1">
            <span className="mr-1 text-xs text-slate-600">How did we handle it?</span>
            {[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" onClick={() => setStars(n)}><Star className={`h-5 w-5 ${n <= stars ? 'fill-amber-400 text-amber-400' : 'text-slate-300'}`} /></button>)}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" className="gap-1 bg-emerald-600 hover:bg-emerald-700" disabled={confirm.isPending} onClick={() => confirm.mutate(true)}><ThumbsUp className="h-4 w-4" /> Yes, thank you</Button>
            <Button size="sm" variant="outline" className="gap-1 text-rose-600" disabled={confirm.isPending} onClick={() => confirm.mutate(false)}><ThumbsDown className="h-4 w-4" /> No, not yet</Button>
          </div>
        </div>
      )}
      {c.status === 'CLOSED' && c.satisfied != null && <p className="text-xs text-slate-500">Sender said: {c.satisfied ? 'solved 👍' : 'not solved 👎'}{c.handlingRating ? ` · ${c.handlingRating}/5` : ''}</p>}

      {/* staff actions */}
      {staff && c.canHandle && c.status !== 'CLOSED' && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 p-2">
          <Select value={c.assignedToId ?? 'none'} onValueChange={(v) => patch.mutate({ assignedToId: v === 'none' ? null : v })}>
            <SelectTrigger className="h-8 w-48"><SelectValue placeholder="Responsible" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Nobody yet</SelectItem>
              {c.handlers.map((h) => <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>)}
            </SelectContent>
          </Select>
          {c.status === 'NEW' && <Button size="sm" variant="outline" className="h-8" onClick={() => patch.mutate({ status: 'IN_PROGRESS' })}>Start handling</Button>}
          {c.status !== 'RESOLVED' && <Button size="sm" className="h-8 bg-emerald-600 hover:bg-emerald-700" onClick={() => patch.mutate({ status: 'RESOLVED' })}>Mark as solved</Button>}
          <Button size="sm" variant="ghost" className="h-8" onClick={() => patch.mutate({ status: 'CLOSED' })}>Close</Button>
        </div>
      )}

      {/* reply */}
      {c.status !== 'CLOSED' && (!staff || c.canHandle) && (
        <div className="space-y-2">
          <textarea className="min-h-[70px] w-full rounded-md border border-slate-200 bg-white p-2" maxLength={5000} placeholder={staff ? 'Reply to the sender…' : 'Add a message…'} value={reply} onChange={(e) => setReply(e.target.value)} />
          <div className="flex items-center justify-between gap-2">
            {staff ? <label className="flex items-center gap-1.5 text-xs text-slate-600"><input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> Internal note (staff only)</label> : <span />}
            <Button size="sm" className="gap-1" disabled={!reply.trim() || send.isPending} onClick={() => send.mutate()}>{send.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send</Button>
          </div>
        </div>
      )}
    </div>
  )
}
