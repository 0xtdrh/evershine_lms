'use client'

/**
 * Six phases E2: the start of a group with a minimum — state (waiting for N more / starts on … / started / cancelled), the
 * expected start date, and the staff decisions: postpone, start anyway (only when the policy allows it and with the
 * permission), cancel (money back to the wallet; each student moved, on the waiting list, or out). API /api/groups/[id]/start.
 */

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarClock } from 'lucide-react'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { L, useI18n } from '@/lib/i18n/client'

type Start = { state: string; min: number | null; count: number; missing: number; expectedStartDate: string | null; firstSession: string | null; startAnywayAllowed: boolean }
type Student = { id: string; name: string }
type Choice = { action: 'MOVE' | 'WAIT' | 'LEAVE'; toGroupId: string }

export function GroupStartPanel({ groupId, levelId, students, can }: { groupId: string; levelId: string | null; students: Student[]; can: { update: boolean; approve: boolean; remove: boolean } }) {
  const { locale } = useI18n()
  const ar = locale === 'ar'
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['group-start', groupId], queryFn: () => fetchApi<Start>(`/api/groups/${groupId}/start`), retry: false })
  const [date, setDate] = useState('')
  const [reason, setReason] = useState('')
  const [cancelling, setCancelling] = useState(false)
  const [choices, setChoices] = useState<Record<string, Choice>>({})
  const others = useQuery({ queryKey: ['groups-same-level', levelId], queryFn: () => fetchApi<{ id: string; label: string }[]>(`/api/groups/available?levelId=${levelId}&excludeId=${groupId}`), enabled: cancelling && !!levelId, retry: false })
  if (!data || data.state === 'NO_MINIMUM' && !data.expectedStartDate) return can.update ? <ExpectedOnly groupId={groupId} /> : null
  const day = (d: string | null) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString(ar ? 'ar-EG-u-nu-latn' : 'en-GB', { timeZone: 'Africa/Cairo', weekday: 'long', day: 'numeric', month: 'long' }) : '—')
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['group-start', groupId] }); void qc.invalidateQueries() }
  const post = async (body: unknown, ok: string) => {
    try { await fetchApi(`/api/groups/${groupId}/start`, { method: 'POST', body: JSON.stringify(body) }); notify.success(ok); refresh() } catch (e) { notify.error((e as Error).message) }
  }
  const tone = data.state === 'WAITING_COUNT' ? 'border-amber-200 bg-amber-50/60' : data.state === 'CANCELLED' ? 'border-red-200 bg-red-50/60' : 'border-emerald-200 bg-emerald-50/60'
  const otherGroups = (Array.isArray(others.data) ? others.data : []).filter((g) => g.id !== groupId)
  return (
    <div className={`rounded-xl border p-3 text-sm ${tone}`}>
      <p className="flex items-center gap-1.5 font-medium text-slate-900"><CalendarClock className="h-4 w-4" aria-hidden /> {L('Group start', 'بداية الجروب')}</p>
      <p className="mt-1 text-slate-800">
        {data.state === 'WAITING_COUNT' ? L(`Waiting for the minimum: ${data.count} of ${data.min} (${data.missing} more). Expected start: ${day(data.expectedStartDate)}.`, `مستني اكتمال العدد: ${data.count} من ${data.min} (ناقص ${data.missing}). البداية المتوقعة: ${day(data.expectedStartDate)}.`)
          : data.state === 'READY' ? L(`Complete — starts ${day(data.firstSession)}.`, `كمل — هيبدأ ${day(data.firstSession)}.`)
          : data.state === 'STARTED' ? L(`Started ${day(data.firstSession)}.`, `بدأ ${day(data.firstSession)}.`)
          : data.state === 'CANCELLED' ? L('This group was cancelled.', 'الجروب ده اتلغى.')
          : L(`Expected start: ${day(data.expectedStartDate)}.`, `البداية المتوقعة: ${day(data.expectedStartDate)}.`)}
      </p>
      {['WAITING_COUNT', 'READY', 'NO_MINIMUM'].includes(data.state) && can.update ? (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label className="text-xs">{data.expectedStartDate ? L('Postpone to', 'أجّل لـ') : L('Expected start', 'البداية المتوقعة')}<input type="date" className="block rounded-lg border border-slate-300 bg-white px-2 py-1" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label className="text-xs">{L('Reason (optional)', 'السبب (اختياري)')}<input className="block rounded-lg border border-slate-300 bg-white px-2 py-1" value={reason} onChange={(e) => setReason(e.target.value)} /></label>
          <button type="button" disabled={!date} onClick={() => void post({ action: 'EXPECTED', date, reason: reason || null }, L('Saved — families told', 'اتحفظ — العائلات اتبلغت'))} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs disabled:opacity-50">{L('Save the date', 'احفظ التاريخ')}</button>
        </div>
      ) : null}
      {data.state === 'WAITING_COUNT' ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {can.approve && data.startAnywayAllowed ? <button type="button" onClick={() => { if (confirm(L('Start below the minimum?', 'تبدأ تحت الحد الأدنى؟'))) void post({ action: 'FORCE' }, L('Started — families told', 'بدأ — العائلات اتبلغت')) }} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white">{L('Start anyway', 'ابدأ برضه')}</button> : null}
          {can.remove ? <button type="button" onClick={() => setCancelling((x) => !x)} className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs text-red-700">{L('Cancel the group…', 'الغي الجروب…')}</button> : null}
        </div>
      ) : null}
      {cancelling && data.state === 'WAITING_COUNT' ? (
        <div className="mt-3 space-y-2 rounded-lg border border-red-200 bg-white p-3">
          <p className="text-xs text-slate-700">{L('Money paid goes back to each family wallet. Choose for each student:', 'الفلوس المدفوعة بترجع لمحفظة كل عيلة. اختار لكل طالب:')}</p>
          {students.map((s) => {
            const c = choices[s.id] ?? { action: 'WAIT', toGroupId: '' }
            return (
              <div key={s.id} className="flex flex-wrap items-center gap-2 text-xs">
                <b className="min-w-[8rem]">{s.name}</b>
                <select className="rounded border border-slate-300 px-1 py-1" value={c.action} onChange={(e) => setChoices({ ...choices, [s.id]: { ...c, action: e.target.value as Choice['action'] } })}>
                  <option value="WAIT">{L('Waiting list', 'قايمة الانتظار')}</option><option value="MOVE">{L('Move to a group', 'انقله لجروب')}</option><option value="LEAVE">{L('Out', 'يخرج')}</option>
                </select>
                {c.action === 'MOVE' ? <select className="rounded border border-slate-300 px-1 py-1" value={c.toGroupId} onChange={(e) => setChoices({ ...choices, [s.id]: { ...c, toGroupId: e.target.value } })}><option value="">—</option>{otherGroups.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}</select> : null}
              </div>
            )
          })}
          <input className="w-full rounded border border-slate-300 px-2 py-1 text-xs" placeholder={L('Reason (families see it)', 'السبب (العائلات بتشوفه)')} value={reason} onChange={(e) => setReason(e.target.value)} />
          <button type="button" disabled={reason.trim().length < 2} onClick={() => { if (confirm(L('Cancel this group? This cannot be undone.', 'تلغي الجروب؟ مش هينفع ترجع.'))) void post({ action: 'CANCEL', reason, choices: students.map((s) => ({ studentId: s.id, action: (choices[s.id] ?? { action: 'WAIT' }).action, toGroupId: choices[s.id]?.toGroupId || null })) }, L('Group cancelled', 'الجروب اتلغى')) }} className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">{L('Cancel the group', 'الغي الجروب')}</button>
        </div>
      ) : null}
    </div>
  )
}

function ExpectedOnly({ groupId }: { groupId: string }) {
  const qc = useQueryClient()
  const [date, setDate] = useState('')
  const save = async () => {
    try { await fetchApi(`/api/groups/${groupId}/start`, { method: 'POST', body: JSON.stringify({ action: 'EXPECTED', date }) }); notify.success(L('Saved', 'اتحفظ')); void qc.invalidateQueries({ queryKey: ['group-start', groupId] }) } catch (e) { notify.error((e as Error).message) }
  }
  return (
    <div className="flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 p-3 text-sm">
      <label className="text-xs">{L('Expected start (shown to families)', 'البداية المتوقعة (بتظهر للعائلات)')}<input type="date" className="block rounded-lg border border-slate-300 px-2 py-1" value={date} onChange={(e) => setDate(e.target.value)} /></label>
      <button type="button" disabled={!date} onClick={() => void save()} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs disabled:opacity-50">{L('Save', 'احفظ')}</button>
    </div>
  )
}
