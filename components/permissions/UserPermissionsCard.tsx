'use client'

/** M1: one staff member's own permission rules (win over their place and their role). Super Admin only. */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { L } from '@/lib/i18n/client'
import { OverridesEditor, type OverrideRule } from './OverridesEditor'
import { KeyRound } from 'lucide-react'

export function UserPermissionsCard({ userId, name, role }: { userId: string; name: string; role: string }) {
  const qc = useQueryClient()
  const { data: rules = [] } = useQuery({ queryKey: ['user-permission-rules', userId], queryFn: () => fetchApi<OverrideRule[]>(`/api/permissions/user/${userId}`) })
  const save = useMutation({
    mutationFn: (items: OverrideRule[]) => fetchApi(`/api/permissions/user/${userId}`, { method: 'PUT', body: JSON.stringify({ items }) }),
    onSuccess: () => { notify.success(L('Saved — applies within 30 seconds', 'اتحفظ — هيشتغل خلال 30 ثانية')); qc.invalidateQueries({ queryKey: ['user-permission-rules', userId] }) },
    onError: (e: Error) => notify.error(e.message),
  })
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm"><KeyRound className="h-4 w-4 text-indigo-600" />{L('Personal permissions', 'صلاحيات خاصة')} — {name}</CardTitle>
        <CardDescription>{L('Rules for this person only. They win over the place and the role settings (Permissions page).', 'قواعد للشخص ده بس. بتكسب إعدادات المكان والدور (صفحة Permissions).')}</CardDescription>
      </CardHeader>
      <CardContent><OverridesEditor rules={rules} role={role} saving={save.isPending} onSave={(items) => save.mutate(items)} /></CardContent>
    </Card>
  )
}
