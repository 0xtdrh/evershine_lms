'use client'

/**
 * Rules & policies: written group rules for the whole company, one place, or one level (rules for one group are
 * added on the group page). They add up with the automatic rules; changing them asks the families to accept again.
 */

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { L } from '@/lib/i18n/client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ListChecks, Plus, Trash2 } from 'lucide-react'

type Scope = 'GLOBAL' | 'CAMPUS' | 'LEVEL'
interface Rule { id: string; scope: string; scopeId: string | null; textEn: string; textAr: string; sortOrder: number; isActive: boolean }
interface Level { id: string; name: string; subject?: { name: string } | null }

export function GroupRulesEditor({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient()
  const [scope, setScope] = useState<Scope>('GLOBAL')
  const [scopeId, setScopeId] = useState('')
  const { data: places = [] } = useQuery({ queryKey: ['campuses'], queryFn: () => fetchApi<{ id: string; name: string }[]>('/api/campuses'), enabled: scope === 'CAMPUS' })
  const { data: levelsRaw } = useQuery({ queryKey: ['levels-all'], queryFn: () => fetchApi<Level[] | { data: Level[] }>('/api/levels'), enabled: scope === 'LEVEL' })
  const levels: Level[] = Array.isArray(levelsRaw) ? levelsRaw : (levelsRaw as { data?: Level[] } | undefined)?.data ?? []
  const ready = scope === 'GLOBAL' || !!scopeId
  const { data: rules = [] } = useQuery({ queryKey: ['written-rules', scope, scopeId], queryFn: () => fetchApi<Rule[]>(`/api/group-rules?scope=${scope}${scopeId ? `&scopeId=${scopeId}` : ''}`), enabled: ready })
  const [f, setF] = useState({ textEn: '', textAr: '' })
  const refresh = () => qc.invalidateQueries({ queryKey: ['written-rules'] })
  const add = useMutation({
    mutationFn: () => fetchApi('/api/group-rules', { method: 'POST', body: JSON.stringify({ scope, scopeId: scope === 'GLOBAL' ? null : scopeId, ...f, sortOrder: rules.length }) }),
    onSuccess: () => { notify.success(L('Rule added', 'القاعدة اتضافت')); setF({ textEn: '', textAr: '' }); refresh() },
    onError: (e: Error) => notify.error(e.message),
  })
  const toggle = useMutation({
    mutationFn: (r: Rule) => fetchApi(`/api/group-rules/${r.id}`, { method: 'PATCH', body: JSON.stringify({ scope: r.scope, scopeId: r.scopeId, textEn: r.textEn, textAr: r.textAr, sortOrder: r.sortOrder, isActive: !r.isActive }) }),
    onSuccess: refresh, onError: (e: Error) => notify.error(e.message),
  })
  const del = useMutation({ mutationFn: (id: string) => fetchApi(`/api/group-rules/${id}`, { method: 'DELETE' }), onSuccess: refresh, onError: (e: Error) => notify.error(e.message) })
  const tab = (s: Scope, label: string) => (
    <button type="button" onClick={() => { setScope(s); setScopeId('') }} className={`rounded-md px-3 py-1.5 text-xs font-medium ${scope === s ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-700'}`}>{label}</button>
  )
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base"><ListChecks className="h-5 w-5 text-indigo-600" />{L('Group rules', 'قواعد الجروبات')}</CardTitle>
        <CardDescription>{L('Every group shows rules made from its settings (times, fee, payment, instalments, size, absence excuses, refunds). Add written rules here for the whole company, a place or a level — they add up. Parents must accept the rules of their child’s group; a change asks them again.', 'كل جروب بيعرض قواعد معمولة من إعداداته (المواعيد، الرسوم، الدفع، التقسيط، العدد، أعذار الغياب، الاسترداد). ضيف هنا قواعد مكتوبة للشركة كلها أو لمكان أو لمستوى — وكلهم بيتجمعوا. أولياء الأمور لازم يوافقوا على قواعد جروب ابنهم، وأي تغيير بيطلب موافقتهم تاني.')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          {tab('GLOBAL', L('Whole company', 'الشركة كلها'))}
          {tab('CAMPUS', L('A place', 'مكان'))}
          {tab('LEVEL', L('A level', 'مستوى'))}
          {scope === 'CAMPUS' && (
            <select className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs" value={scopeId} onChange={(e) => setScopeId(e.target.value)}>
              <option value="">{L('Choose a place', 'اختار مكان')}</option>
              {places.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          {scope === 'LEVEL' && (
            <select className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs" value={scopeId} onChange={(e) => setScopeId(e.target.value)}>
              <option value="">{L('Choose a level', 'اختار مستوى')}</option>
              {levels.map((l) => <option key={l.id} value={l.id}>{l.subject?.name ? `${l.subject.name} › ` : ''}{l.name}</option>)}
            </select>
          )}
        </div>
        {ready && (
          <>
            <ol className="list-decimal space-y-1 ps-5">
              {rules.map((r) => (
                <li key={r.id} className={r.isActive ? '' : 'opacity-50'}>
                  <span>{L(r.textEn, r.textAr)}</span>
                  {canEdit && (
                    <span className="ms-2 inline-flex gap-2 text-xs">
                      <button type="button" className="text-slate-500 hover:underline" onClick={() => toggle.mutate(r)}>{r.isActive ? L('switch off', 'وقّف') : L('switch on', 'شغّل')}</button>
                      <button type="button" className="text-slate-400 hover:text-rose-600" onClick={() => confirm(L('Delete this rule?', 'تمسح القاعدة دي؟')) && del.mutate(r.id)}><Trash2 className="inline h-3.5 w-3.5" /></button>
                    </span>
                  )}
                </li>
              ))}
              {!rules.length && <li className="list-none text-xs text-slate-500">{L('No written rules here yet.', 'لسه مفيش قواعد مكتوبة هنا.')}</li>}
            </ol>
            {canEdit && (
              <div className="space-y-2 rounded-md bg-slate-50 p-2">
                <Input className="h-8" placeholder="English" value={f.textEn} onChange={(e) => setF({ ...f, textEn: e.target.value })} />
                <Input className="h-8" dir="rtl" placeholder="عربي" value={f.textAr} onChange={(e) => setF({ ...f, textAr: e.target.value })} />
                <Button size="sm" disabled={add.isPending || f.textEn.trim().length < 2 || f.textAr.trim().length < 2} onClick={() => add.mutate()}><Plus className="me-1 h-4 w-4" />{L('Add rule', 'ضيف قاعدة')}</Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
