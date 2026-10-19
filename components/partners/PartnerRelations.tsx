'use client'

/** Partners part 1-B2: people at the partner (contacts, one main) and the log of calls / meetings / visits with follow-ups. */

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { L } from '@/lib/i18n/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { CalendarClock, CheckCircle2, Loader2, Phone, Plus, Star, Trash2, UserRound } from 'lucide-react'
import { DateInput } from '@/components/ui/date-input'

interface Contact { id: string; name: string; role: string; jobTitle: string | null; phone: string | null; email: string | null; isPrimary: boolean; notes: string | null }
interface Activity { id: string; kind: string; happenedAt: string; summary: string; followUpAt: string | null; followUpDoneAt: string | null }

const ROLES: Record<string, [string, string]> = { DECISION_MAKER: ['Decision maker', 'صاحب القرار'], FINANCE: ['Finance', 'الحسابات'], ACADEMIC: ['Academic coordinator', 'المنسق الأكاديمي'], PLACE_MANAGER: ['Place manager', 'مدير المكان'], OTHER: ['Other', 'غيره'] }
const KINDS: Record<string, [string, string]> = { CALL: ['Call', 'مكالمة'], MEETING: ['Meeting', 'اجتماع'], VISIT: ['Visit', 'زيارة'], MESSAGE: ['Message', 'رسالة'], OTHER: ['Other', 'غيره'] }
const today = () => new Date().toISOString().slice(0, 10)

export function PartnerRelations({ partnerId, canEdit }: { partnerId: string; canEdit: boolean }) {
  const qc = useQueryClient()
  const { data: contacts = [] } = useQuery({ queryKey: ['partner-contacts', partnerId], queryFn: () => fetchApi<Contact[]>(`/api/partners/${partnerId}/contacts`) })
  const { data: acts = [], isLoading } = useQuery({ queryKey: ['partner-activities', partnerId], queryFn: () => fetchApi<Activity[]>(`/api/partners/${partnerId}/activities`) })
  const [c, setC] = useState({ name: '', role: 'DECISION_MAKER', jobTitle: '', phone: '', email: '', isPrimary: false })
  const [a, setA] = useState({ kind: 'CALL', happenedAt: today(), summary: '', followUpAt: '' })
  const err = (e: Error) => notify.error(e.message)
  const refresh = () => { qc.invalidateQueries({ queryKey: ['partner-contacts', partnerId] }); qc.invalidateQueries({ queryKey: ['partner-activities', partnerId] }); qc.invalidateQueries({ queryKey: ['partners-overview'] }) }
  const addC = useMutation({ mutationFn: () => fetchApi(`/api/partners/${partnerId}/contacts`, { method: 'POST', body: JSON.stringify(c) }), onSuccess: () => { notify.success(L('Saved', 'اتحفظ')); setC({ name: '', role: 'OTHER', jobTitle: '', phone: '', email: '', isPrimary: false }); refresh() }, onError: err })
  const mainC = useMutation({ mutationFn: (x: Contact) => fetchApi(`/api/partner-contacts/${x.id}`, { method: 'PATCH', body: JSON.stringify({ ...x, isPrimary: true }) }), onSuccess: refresh, onError: err })
  const delC = useMutation({ mutationFn: (id: string) => fetchApi(`/api/partner-contacts/${id}`, { method: 'DELETE' }), onSuccess: refresh, onError: err })
  const addA = useMutation({ mutationFn: () => fetchApi(`/api/partners/${partnerId}/activities`, { method: 'POST', body: JSON.stringify(a) }), onSuccess: () => { notify.success(L('Saved', 'اتحفظ')); setA({ kind: 'CALL', happenedAt: today(), summary: '', followUpAt: '' }); refresh() }, onError: err })
  const doneA = useMutation({ mutationFn: (x: Activity) => fetchApi(`/api/partner-activities/${x.id}`, { method: 'PATCH', body: JSON.stringify({ kind: x.kind, happenedAt: x.happenedAt.slice(0, 10), summary: x.summary, followUpAt: x.followUpAt?.slice(0, 10) ?? null, followUpDone: true }) }), onSuccess: refresh, onError: err })
  const delA = useMutation({ mutationFn: (id: string) => fetchApi(`/api/partner-activities/${id}`, { method: 'DELETE' }), onSuccess: refresh, onError: err })
  return (
    <div className="grid gap-4 text-sm lg:grid-cols-2">
      <section className="space-y-2">
        <h3 className="flex items-center gap-2 font-semibold"><UserRound className="h-4 w-4 text-indigo-600" />{L('People at the partner', 'المسؤولين عند الشريك')}</h3>
        <ul className="space-y-2">
          {contacts.map((x) => (
            <li key={x.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 p-2">
              {x.isPrimary && <Star className="h-4 w-4 fill-amber-400 text-amber-400" />}
              <span className="font-medium">{x.name}</span>
              <span className="text-xs text-slate-500">{L(...(ROLES[x.role] ?? [x.role, x.role]))}{x.jobTitle ? ` · ${x.jobTitle}` : ''}</span>
              {x.phone && <a className="flex items-center gap-1 text-xs text-indigo-700" href={`tel:${x.phone}`}><Phone className="h-3 w-3" />{x.phone}</a>}
              {x.email && <a className="text-xs text-indigo-700" href={`mailto:${x.email}`}>{x.email}</a>}
              {canEdit && (
                <span className="ms-auto flex gap-1">
                  {!x.isPrimary && <Button size="sm" variant="ghost" onClick={() => mainC.mutate(x)}>{L('Make main', 'خليه الأساسي')}</Button>}
                  <button type="button" className="text-slate-400 hover:text-rose-600" onClick={() => confirm(L('Remove this person?', 'تشيل الشخص ده؟')) && delC.mutate(x.id)}><Trash2 className="h-4 w-4" /></button>
                </span>
              )}
            </li>
          ))}
          {!contacts.length && <li className="text-xs text-slate-500">{L('No people yet.', 'لسه مفيش.')}</li>}
        </ul>
        {canEdit && (
          <div className="grid gap-2 rounded-lg bg-slate-50 p-2 sm:grid-cols-2">
            <Input className="h-8" placeholder={L('Name', 'الاسم')} value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} />
            <select className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs" value={c.role} onChange={(e) => setC({ ...c, role: e.target.value })}>
              {Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{L(...v)}</option>)}
            </select>
            <Input className="h-8" placeholder={L('Job title', 'الوظيفة')} value={c.jobTitle} onChange={(e) => setC({ ...c, jobTitle: e.target.value })} />
            <Input className="h-8" placeholder={L('Phone', 'التليفون')} value={c.phone} onChange={(e) => setC({ ...c, phone: e.target.value })} />
            <Input className="h-8" placeholder={L('Email', 'الإيميل')} value={c.email} onChange={(e) => setC({ ...c, email: e.target.value })} />
            <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={c.isPrimary} onChange={(e) => setC({ ...c, isPrimary: e.target.checked })} />{L('Main contact', 'المسؤول الأساسي')}</label>
            <Button size="sm" className="sm:col-span-2" disabled={addC.isPending || c.name.trim().length < 2} onClick={() => addC.mutate()}><Plus className="me-1 h-4 w-4" />{L('Add person', 'ضيف شخص')}</Button>
          </div>
        )}
      </section>
      <section className="space-y-2">
        <h3 className="flex items-center gap-2 font-semibold"><CalendarClock className="h-4 w-4 text-indigo-600" />{L('Calls, meetings and visits', 'المكالمات والاجتماعات والزيارات')}</h3>
        {canEdit && (
          <div className="space-y-2 rounded-lg bg-slate-50 p-2">
            <div className="flex flex-wrap gap-2">
              <select className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs" value={a.kind} onChange={(e) => setA({ ...a, kind: e.target.value })}>
                {Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{L(...v)}</option>)}
              </select>
              <DateInput className="h-8 w-36" value={a.happenedAt} onChange={(e) => setA({ ...a, happenedAt: e.target.value })} />
              <span className="flex items-center gap-1 text-xs text-slate-500">{L('Follow up on', 'متابعة يوم')}<DateInput className="h-8 w-36" value={a.followUpAt} onChange={(e) => setA({ ...a, followUpAt: e.target.value })} /></span>
            </div>
            <Textarea rows={2} placeholder={L('What was said / agreed', 'اتكلمتوا في إيه / اتفقتوا على إيه')} value={a.summary} onChange={(e) => setA({ ...a, summary: e.target.value })} />
            <Button size="sm" disabled={addA.isPending || a.summary.trim().length < 2} onClick={() => addA.mutate()}><Plus className="me-1 h-4 w-4" />{L('Save', 'احفظ')}</Button>
          </div>
        )}
        {isLoading && <Loader2 className="h-5 w-5 animate-spin text-slate-400" />}
        <ul className="space-y-2">
          {acts.map((x) => {
            const due = x.followUpAt && !x.followUpDoneAt && x.followUpAt.slice(0, 10) <= today()
            return (
              <li key={x.id} className={`space-y-1 rounded-lg border p-2 ${due ? 'border-amber-300 bg-amber-50' : 'border-slate-200'}`}>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-semibold">{L(...(KINDS[x.kind] ?? [x.kind, x.kind]))}</span>
                  <span className="text-slate-500">{x.happenedAt.slice(0, 10)}</span>
                  {x.followUpAt && <span className={x.followUpDoneAt ? 'text-emerald-700' : 'text-amber-700'}>{L('follow-up', 'متابعة')} {x.followUpAt.slice(0, 10)}{x.followUpDoneAt ? ` ✓` : ''}</span>}
                  {canEdit && (
                    <span className="ms-auto flex gap-1">
                      {x.followUpAt && !x.followUpDoneAt && <Button size="sm" variant="ghost" onClick={() => doneA.mutate(x)}><CheckCircle2 className="me-1 h-4 w-4" />{L('Done', 'خلصت')}</Button>}
                      <button type="button" className="text-slate-400 hover:text-rose-600" onClick={() => confirm(L('Delete?', 'تمسح؟')) && delA.mutate(x.id)}><Trash2 className="h-4 w-4" /></button>
                    </span>
                  )}
                </div>
                <p className="whitespace-pre-wrap">{x.summary}</p>
              </li>
            )
          })}
          {!isLoading && !acts.length && <li className="text-xs text-slate-500">{L('Nothing logged yet.', 'لسه مفيش حاجة متسجلة.')}</li>}
        </ul>
      </section>
    </div>
  )
}
