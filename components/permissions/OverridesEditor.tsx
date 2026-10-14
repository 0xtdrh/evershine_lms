'use client'

/**
 * M1: a short list of permission rules (allow / deny) that win over the role setting — used for one person (Credential
 * management) and for the staff of one place (Partners → Permissions). Only the rules that differ are stored.
 */

import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { L } from '@/lib/i18n/client'
import { DEFAULT_PERMISSION_MATRIX } from '@/lib/rbac'
import { RESOURCE_LABEL } from '@/lib/admin/permission-labels'
import { Loader2, Plus, Trash2 } from 'lucide-react'

export interface OverrideRule { resource: string; action: string; allowed: boolean }

const ACTIONS = ['read', 'create', 'update', 'delete', 'export', 'approve'] as const
const ACTION_LABEL: Record<string, [string, string]> = {
  read: ['View', 'عرض'], create: ['Add', 'إضافة'], update: ['Edit', 'تعديل'], delete: ['Delete', 'مسح'], export: ['Export', 'تصدير'], approve: ['Approve', 'اعتماد'],
}
const RESOURCES = Object.keys(DEFAULT_PERMISSION_MATRIX.SUPER_ADMIN).sort((a, b) => RESOURCE_LABEL(a).localeCompare(RESOURCE_LABEL(b)))

/** What the role has by default (the code matrix; the Permissions page may differ). null = several roles. */
function roleDefault(role: string | null, resource: string, action: string): boolean | null {
  if (!role || role === 'ALL') return null
  const m = DEFAULT_PERMISSION_MATRIX[role as keyof typeof DEFAULT_PERMISSION_MATRIX] as Record<string, string[]> | undefined
  return !!m?.[resource]?.includes(action)
}

export function OverridesEditor({ rules, role, saving, onSave }: { rules: OverrideRule[]; role: string | null; saving: boolean; onSave: (rules: OverrideRule[]) => void }) {
  const [list, setList] = useState<OverrideRule[]>(rules)
  const [draft, setDraft] = useState<OverrideRule>({ resource: 'partners', action: 'read', allowed: true })
  useEffect(() => setList(rules), [rules])
  const dirty = useMemo(() => JSON.stringify(list) !== JSON.stringify(rules), [list, rules])
  const add = () => {
    setList((l) => [...l.filter((x) => !(x.resource === draft.resource && x.action === draft.action)), { ...draft }])
  }
  const def = roleDefault(role, draft.resource, draft.action)
  return (
    <div className="space-y-3 text-sm">
      {list.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-200 p-3 text-xs text-slate-500">{L('No special rules — the role settings apply.', 'مفيش قواعد خاصة — إعدادات الدور هي اللي شغالة.')}</p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {list.map((r) => {
            const d = roleDefault(role, r.resource, r.action)
            return (
              <li key={`${r.resource}:${r.action}`} className="flex flex-wrap items-center gap-2 px-3 py-2">
                <span className="font-medium text-slate-800">{RESOURCE_LABEL(r.resource)}</span>
                <span className="text-slate-500">· {L(...ACTION_LABEL[r.action] ?? [r.action, r.action])}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${r.allowed ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>{r.allowed ? L('Allowed', 'مسموح') : L('Not allowed', 'ممنوع')}</span>
                {d !== null && d === r.allowed && <span className="text-xs text-amber-600">{L('(same as the role)', '(زي الدور أصلًا)')}</span>}
                <button type="button" className="ms-auto text-slate-400 hover:text-rose-600" onClick={() => setList((l) => l.filter((x) => x !== r))} aria-label={L('Remove', 'شيل')}><Trash2 className="h-4 w-4" /></button>
              </li>
            )
          })}
        </ul>
      )}
      <div className="flex flex-wrap items-end gap-2 rounded-lg bg-slate-50 p-2">
        <select className="h-9 min-w-[12rem] rounded-md border border-slate-200 bg-white px-2 text-sm" value={draft.resource} onChange={(e) => setDraft({ ...draft, resource: e.target.value })}>
          {RESOURCES.map((r) => <option key={r} value={r}>{RESOURCE_LABEL(r)}</option>)}
        </select>
        <select className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm" value={draft.action} onChange={(e) => setDraft({ ...draft, action: e.target.value })}>
          {ACTIONS.map((a) => <option key={a} value={a}>{L(...ACTION_LABEL[a])}</option>)}
        </select>
        <select className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm" value={draft.allowed ? '1' : '0'} onChange={(e) => setDraft({ ...draft, allowed: e.target.value === '1' })}>
          <option value="1">{L('Allow', 'اسمح')}</option>
          <option value="0">{L('Do not allow', 'امنع')}</option>
        </select>
        <Button type="button" size="sm" variant="outline" onClick={add}><Plus className="me-1 h-4 w-4" />{L('Add rule', 'ضيف قاعدة')}</Button>
        {def !== null && <span className="text-xs text-slate-500">{L('The role has it: ', 'الدور عنده: ')}{def ? L('yes', 'أيوه') : L('no', 'لأ')}</span>}
      </div>
      <div className="flex justify-end">
        <Button type="button" size="sm" disabled={!dirty || saving} onClick={() => onSave(list)}>
          {saving && <Loader2 className="me-1 h-4 w-4 animate-spin" />}{L('Save rules', 'احفظ القواعد')}
        </Button>
      </div>
    </div>
  )
}
