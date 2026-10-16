'use client'

/**
 * Rules & policies: a group's rules (automatic from its settings + company / place / level / group written rules),
 * which families accepted the current rules, a rule just for this group, and a printable copy for signing.
 */

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { L } from '@/lib/i18n/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ChevronDown, ChevronUp, ListChecks, Plus, Printer } from 'lucide-react'

interface Status {
  items: { source: string; en: string; ar: string }[]
  families: { studentId: string; student: string; parent: string | null; phone: string | null; acceptedAt: string | null }[]
}

export const SOURCE_LABEL: Record<string, [string, string]> = {
  AUTO: ['from the group settings', 'من إعدادات الجروب'], GLOBAL: ['company', 'الشركة'], CAMPUS: ['place', 'المكان'], LEVEL: ['level', 'المستوى'], GROUP: ['this group', 'الجروب ده'],
}

export function GroupRulesPanel({ groupId, canEditRules }: { groupId: string; canEditRules: boolean }) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const { data } = useQuery({ queryKey: ['group-rules', groupId], queryFn: () => fetchApi<Status>(`/api/groups/${groupId}/rules`), enabled: open })
  const [f, setF] = useState({ textEn: '', textAr: '' })
  const add = useMutation({
    mutationFn: () => fetchApi('/api/group-rules', { method: 'POST', body: JSON.stringify({ scope: 'GROUP', scopeId: groupId, ...f }) }),
    onSuccess: () => { notify.success(L('Rule added — families will be asked to accept again', 'القاعدة اتضافت — أولياء الأمور هيتطلب منهم يوافقوا تاني')); setF({ textEn: '', textAr: '' }); qc.invalidateQueries({ queryKey: ['group-rules', groupId] }) },
    onError: (e: Error) => notify.error(e.message),
  })
  const accepted = data?.families.filter((x) => x.acceptedAt).length ?? 0
  return (
    <div className="rounded-lg border border-slate-200 text-sm">
      <button type="button" className="flex w-full items-center gap-2 p-3 text-start" onClick={() => setOpen(!open)}>
        <ListChecks className="h-4 w-4 text-indigo-600" />
        <span className="font-medium">{L('Group rules', 'قواعد الجروب')}</span>
        {data && <span className="text-xs text-slate-500">· {accepted}/{data.families.length} {L('families accepted', 'ولي أمر وافق')}</span>}
        <span className="ms-auto">{open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</span>
      </button>
      {open && data && (
        <div className="space-y-3 border-t border-slate-100 p-3">
          <ol className="list-decimal space-y-1 ps-5">
            {data.items.map((x, i) => <li key={i}>{L(x.en, x.ar)} <span className="text-xs text-slate-400">({L(...(SOURCE_LABEL[x.source] ?? [x.source, x.source]))})</span></li>)}
          </ol>
          {canEditRules && (
            <div className="space-y-2 rounded-md bg-slate-50 p-2">
              <p className="text-xs font-semibold">{L('Add a rule for this group only', 'ضيف قاعدة للجروب ده بس')}</p>
              <Input className="h-8" placeholder="English" value={f.textEn} onChange={(e) => setF({ ...f, textEn: e.target.value })} />
              <Input className="h-8" dir="rtl" placeholder="عربي" value={f.textAr} onChange={(e) => setF({ ...f, textAr: e.target.value })} />
              <Button size="sm" disabled={add.isPending || f.textEn.trim().length < 2 || f.textAr.trim().length < 2} onClick={() => add.mutate()}><Plus className="me-1 h-4 w-4" />{L('Add', 'ضيف')}</Button>
              <p className="text-xs text-slate-500">{L('Rules for the company, a place or a level: Agreements page → Group rules.', 'قواعد الشركة أو المكان أو المستوى: من صفحة الاتفاقيات ← قواعد الجروبات.')}</p>
            </div>
          )}
          <div>
            <p className="mb-1 text-xs font-semibold">{L('Families', 'أولياء الأمور')}</p>
            <ul className="space-y-1 text-xs">
              {data.families.map((x) => (
                <li key={x.studentId} className="flex flex-wrap gap-2">
                  <span className="font-medium">{x.student}</span>
                  <span className="text-slate-500">{x.parent ?? ''}{x.phone ? ` · ${x.phone}` : ''}</span>
                  <span className={x.acceptedAt ? 'text-emerald-700' : 'text-amber-700'}>{x.acceptedAt ? `${L('accepted', 'وافق')} ${x.acceptedAt.slice(0, 10)}` : L('not yet', 'لسه')}</span>
                  <a className="ms-auto text-indigo-700 hover:underline" href={`/reports/group-rules/${groupId}?student=${x.studentId}`} target="_blank" rel="noopener">{L('print to sign', 'اطبع للإمضاء')}</a>
                </li>
              ))}
              {!data.families.length && <li className="text-slate-500">{L('No students yet.', 'لسه مفيش طلاب.')}</li>}
            </ul>
          </div>
          <a href={`/reports/group-rules/${groupId}`} target="_blank" rel="noopener"><Button size="sm" variant="outline"><Printer className="me-1 h-4 w-4" />{L('Print the rules', 'اطبع القواعد')}</Button></a>
        </div>
      )}
    </div>
  )
}
