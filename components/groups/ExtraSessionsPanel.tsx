'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { CalendarPlus, X } from 'lucide-react'

export interface ExtraSessionRow { id: string; date: string; time: string; reason: string | null }

/** One-off extra sessions for a group (e.g. to make up a holiday). They count like normal sessions. */
export function ExtraSessionsPanel({ groupId, rows, canEdit }: { groupId: string; rows: ExtraSessionRow[]; canEdit: boolean }) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [date, setDate] = useState('')
  const [time, setTime] = useState('16:00')
  const [reason, setReason] = useState('')
  const refresh = () => { qc.invalidateQueries({ queryKey: ['group-detail'] }); qc.invalidateQueries({ queryKey: ['groups-schedule'] }) }
  const add = useMutation({
    mutationFn: () => fetchApi(`/api/groups/${groupId}/extra-sessions`, { method: 'POST', body: JSON.stringify({ date, time, reason: reason.trim() || null }) }),
    onSuccess: () => { notify.success('Extra session added'); setOpen(false); setDate(''); setReason(''); refresh() },
    onError: (e: Error) => notify.error(e.message || 'Could not add it'),
  })
  const remove = useMutation({
    mutationFn: (id: string) => fetchApi(`/api/groups/${groupId}/extra-sessions/${id}`, { method: 'DELETE' }),
    onSuccess: () => { notify.success('Removed'); refresh() },
    onError: (e: Error) => notify.error(e.message || 'Could not remove it'),
  })
  if (!canEdit && rows.length === 0) return null
  return (
    <div className="mb-3 space-y-1.5 rounded-xl border border-slate-100 p-3 text-sm">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 font-medium text-slate-700"><CalendarPlus className="h-4 w-4 text-indigo-600" /> Extra sessions</span>
        {canEdit && <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setOpen(!open)}>{open ? 'Close' : 'Add extra session'}</Button>}
      </div>
      {rows.length === 0 && <p className="text-xs text-slate-400">None. Use this to make up a holiday so the month does not run late.</p>}
      {rows.map((r) => (
        <div key={r.id} className="flex items-center justify-between rounded border border-slate-100 px-2 py-1 text-xs">
          <span>{new Date(`${r.date}T00:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' })} · {r.time}{r.reason ? ` · ${r.reason}` : ''}</span>
          {canEdit && <button type="button" onClick={() => remove.mutate(r.id)} className="text-rose-500 hover:text-rose-700" aria-label="Remove"><X className="h-3.5 w-3.5" /></button>}
        </div>
      ))}
      {open && (
        <div className="flex flex-wrap items-end gap-2 pt-1">
          <Input type="date" className="h-8 w-40 text-xs" value={date} onChange={(e) => setDate(e.target.value)} />
          <Input type="time" className="h-8 w-28 text-xs" value={time} onChange={(e) => setTime(e.target.value)} />
          <Input className="h-8 flex-1 text-xs" placeholder="Reason (e.g. make up the holiday)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <Button size="sm" className="h-8 text-xs" disabled={!date || !time || add.isPending} onClick={() => add.mutate()}>Add</Button>
        </div>
      )}
    </div>
  )
}
