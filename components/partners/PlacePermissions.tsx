'use client'

/**
 * M1: permission rules for the staff of one place (their primary place) — for one role or all roles. They win over
 * the role setting (Permissions page); a person's own rules (Credential management) win over these. Super Admin only.
 */

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { L } from '@/lib/i18n/client'
import { OverridesEditor, type OverrideRule } from '@/components/permissions/OverridesEditor'
import type { PartnerDetail } from './types'

const ROLE_LABEL: Record<string, [string, string]> = {
  ALL: ['All roles', 'كل الأدوار'], ADMIN: ['Admin', 'أدمن'], BRANCH_MANAGER: ['Branch manager', 'مدير فرع'], ACCOUNTANT: ['Accountant', 'محاسب'],
  SECRETARY: ['Secretary', 'سكرتارية'], MARKETING: ['Marketing', 'ماركتنج'], TEACHER: ['Instructor', 'مدرب'],
}

export function PlacePermissions({ p }: { p: PartnerDetail }) {
  const qc = useQueryClient()
  const [placeId, setPlaceId] = useState(p.places[0]?.id ?? '')
  const [role, setRole] = useState('ALL')
  const { data } = useQuery({
    queryKey: ['place-permission-rules', placeId],
    queryFn: () => fetchApi<{ roles: string[]; items: (OverrideRule & { role: string })[] }>(`/api/permissions/place/${placeId}`),
    enabled: !!placeId,
  })
  const rules = useMemo(() => (data?.items ?? []).filter((r) => r.role === role).map(({ resource, action, allowed }) => ({ resource, action, allowed })), [data, role])
  const save = useMutation({
    mutationFn: (items: OverrideRule[]) => fetchApi(`/api/permissions/place/${placeId}`, { method: 'PUT', body: JSON.stringify({ role, items }) }),
    onSuccess: () => { notify.success(L('Saved — applies within 30 seconds', 'اتحفظ — هيشتغل خلال 30 ثانية')); qc.invalidateQueries({ queryKey: ['place-permission-rules', placeId] }) },
    onError: (e: Error) => notify.error(e.message),
  })
  if (!p.places.length) return <p className="text-sm text-slate-500">{L('Add a place first.', 'ضيف مكان الأول.')}</p>
  const counts = (r: string) => (data?.items ?? []).filter((x) => x.role === r).length
  return (
    <div className="space-y-3 text-sm">
      <p className="text-xs text-slate-500">{L('For staff whose main place is this place. Order: the person’s own rules → these rules → the role (Permissions page).', 'للموظفين اللي مكانهم الأساسي المكان ده. الترتيب: قواعد الشخص نفسه ← القواعد دي ← الدور (صفحة Permissions).')}</p>
      <div className="flex flex-wrap gap-2">
        <select className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm" value={placeId} onChange={(e) => setPlaceId(e.target.value)}>
          {p.places.map((pl) => <option key={pl.id} value={pl.id}>{pl.name}</option>)}
        </select>
        <select className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm" value={role} onChange={(e) => setRole(e.target.value)}>
          {(data?.roles ?? Object.keys(ROLE_LABEL)).map((r) => <option key={r} value={r}>{L(...(ROLE_LABEL[r] ?? [r, r]))}{counts(r) ? ` (${counts(r)})` : ''}</option>)}
        </select>
      </div>
      <OverridesEditor rules={rules} role={role === 'ALL' ? null : role} saving={save.isPending} onSave={(items) => save.mutate(items)} />
    </div>
  )
}
