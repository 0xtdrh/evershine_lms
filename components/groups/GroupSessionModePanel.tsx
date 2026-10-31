'use client'

/**
 * a02 M1 batch 2 (2026-10-31): one session taught another way — for the whole group (families are told) or for one
 * student (e.g. online while travelling; the attendance screen shows "attends online"). API /api/groups/[id]/session-mode.
 */

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DateInput } from '@/components/ui/date-input'
import { L, useI18n } from '@/lib/i18n/client'
import { MODES, MODE_LABEL, type Mode } from '@/lib/delivery/modes'
import { MODE_ICON } from '@/components/delivery/TemplatesManager'
import { ArrowLeftRight } from 'lucide-react'

export function GroupSessionModePanel({ groupId, students }: { groupId: string; students: { id: string; name: string }[] }) {
  const ar = useI18n().locale === 'ar'
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [date, setDate] = useState('')
  const [mode, setMode] = useState<Mode | ''>('ONLINE')
  const [who, setWho] = useState('')
  const [note, setNote] = useState('')
  const save = useMutation({
    mutationFn: () => fetchApi(`/api/groups/${groupId}/session-mode`, {
      method: 'POST',
      body: JSON.stringify({ date, mode: mode || null, ...(who ? { studentId: who } : { note: note || null }) }),
    }),
    onSuccess: () => {
      notify.success(who ? L('Saved for this student', 'اتحفظ للطالب ده') : L('Saved — the families are told', 'اتحفظ — والأهالي اتبلّغوا'))
      setOpen(false); setNote('')
      ;['groups-schedule', 'group-detail', 'upcoming-sessions'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }))
    },
    onError: (e: Error) => notify.error(e.message),
  })
  if (!open) {
    return (
      <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setOpen(true)}>
        <ArrowLeftRight className="h-3.5 w-3.5" />{L('A session another way', 'حصة بطريقة مختلفة')}
      </Button>
    )
  }
  return (
    <div className="space-y-2 rounded-lg border border-indigo-200 bg-indigo-50/40 p-3 text-sm">
      <p className="font-semibold text-slate-800">{L('A session another way', 'حصة بطريقة مختلفة')}</p>
      <div className="flex flex-wrap items-center gap-2">
        <DateInput value={date} onChange={(e) => setDate(e.target.value)} />
        <select aria-label={L('Way', 'الطريقة')} className="h-9 rounded-md border px-2 text-sm" value={mode} onChange={(e) => setMode(e.target.value as Mode | '')}>
          {MODES.map((m) => <option key={m} value={m}>{MODE_ICON[m]} {MODE_LABEL[m][ar ? 'ar' : 'en']}</option>)}
          <option value="">{L('Back to the normal way', 'رجّعها لطريقتها العادية')}</option>
        </select>
        <select aria-label={L('For whom', 'لمين')} className="h-9 rounded-md border px-2 text-sm" value={who} onChange={(e) => setWho(e.target.value)}>
          <option value="">{L('The whole group', 'الجروب كله')}</option>
          {students.map((s) => <option key={s.id} value={s.id}>{L('Only:', 'بس:')} {s.name}</option>)}
        </select>
      </div>
      {!who && <Input className="h-8" aria-label={L('Note for families', 'ملاحظة للأهالي')} placeholder={L('Note for families (optional)', 'ملاحظة للأهالي (اختياري)')} value={note} onChange={(e) => setNote(e.target.value)} />}
      <p className="text-xs text-slate-500">{who ? L('Only this student; the attendance screen shows it.', 'للطالب ده بس؛ وبتظهر في شاشة الحضور.') : L('The whole group; families get a message (Arabic + English).', 'للجروب كله؛ والأهالي بيوصلهم إشعار.')}</p>
      <div className="flex gap-2">
        <Button size="sm" disabled={!date || save.isPending} onClick={() => save.mutate()}>{L('Save', 'احفظ')}</Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>{L('Cancel', 'إلغاء')}</Button>
      </div>
    </div>
  )
}
