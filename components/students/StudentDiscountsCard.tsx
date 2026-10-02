'use client'

import { useState } from 'react'
import { useSession } from 'next-auth/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { BadgePercent, Plus } from 'lucide-react'
import { GiveDiscountDialog } from '@/components/discounts/GiveDiscountDialog'

interface Assignment {
  id: string
  status: string
  value: number
  reason: string | null
  discountType: { name: string; valueType: string; duration: string }
  group: { id: string; name: string } | null
  track: { id: string; name: string } | null
  studentId: string | null
  requestedBy: string | null
  createdAt: string
}

const STATUS_CLASS: Record<string, string> = {
  ACTIVE: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  PENDING: 'bg-amber-50 text-amber-700 border-amber-200',
  REJECTED: 'bg-rose-50 text-rose-700 border-rose-200',
  ENDED: 'bg-slate-100 text-slate-600 border-slate-200',
}

/** Discounts of one student (their own + whole-group discounts of their groups). */
export function StudentDiscountsCard({
  studentId,
  studentName,
  groups,
}: {
  studentId: string
  studentName: string
  groups: { id: string; name: string }[]
}) {
  const { data: session, status } = useSession()
  const role = session?.user?.role
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const { data: perms } = useQuery({
    queryKey: ['my-permissions', role],
    queryFn: () => fetchApi<{ permissions: Record<string, string[]> }>('/api/me/permissions'),
    staleTime: 60_000,
    enabled: status === 'authenticated' && !!role,
  })
  const p = perms?.permissions ?? {}
  const canRead = !!p.discounts?.includes('read')
  const canGive = !!p.discounts?.includes('create') || !!p.discount_approvals?.includes('approve')
  const canEnd = !!p.discounts?.includes('update') || !!p.discount_approvals?.includes('approve')

  const { data: own } = useQuery({
    queryKey: ['discounts', 'student', studentId],
    queryFn: () => fetchApi<Assignment[]>(`/api/discounts?studentId=${studentId}`),
    enabled: canRead,
  })
  const end = useMutation({
    mutationFn: (id: string) => fetchApi(`/api/discounts/${id}`, { method: 'PATCH', body: JSON.stringify({ action: 'end' }) }),
    onSuccess: () => {
      notify.success('Discount stopped from the next invoice')
      qc.invalidateQueries({ queryKey: ['discounts'] })
    },
    onError: (err: Error) => notify.error(err.message || 'Could not stop it'),
  })

  if (!canRead) return null
  const rows = (own ?? []).filter((a) => a.status !== 'REJECTED' || Date.now() - new Date(a.createdAt).getTime() < 30 * 86400000)

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-sm"><BadgePercent className="h-4 w-4" /> Discounts</CardTitle>
          {canGive && (
            <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
              <Plus className="mr-1 h-4 w-4" /> Add
            </Button>
          )}
        </div>
        <CardDescription>Automatic discounts (siblings, offers) are added on each invoice by the system.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.length === 0 && <p className="text-sm text-muted-foreground">No discounts given by hand.</p>}
        {rows.map((a) => (
          <div key={a.id} className="rounded border px-3 py-2 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">
                {a.discountType.name} · {a.discountType.valueType === 'PERCENT' ? `${a.value}%` : `${a.value.toLocaleString()} EGP`}
              </span>
              <span className={`rounded border px-1.5 py-0.5 text-xs ${STATUS_CLASS[a.status] ?? ''}`}>{a.status}</span>
            </div>
            <div className="text-xs text-muted-foreground">
              {a.group ? `Group ${a.group.name}` : a.track ? `Track ${a.track.name}` : 'All groups'}
              {a.requestedBy ? ` · by ${a.requestedBy}` : ''}
              {a.reason ? ` · ${a.reason}` : ''}
            </div>
            {canEnd && (a.status === 'ACTIVE' || a.status === 'PENDING') && a.studentId && (
              <Button size="sm" variant="ghost" className="mt-1 h-7 px-2 text-xs" onClick={() => end.mutate(a.id)} disabled={end.isPending}>
                Stop
              </Button>
            )}
          </div>
        ))}
      </CardContent>
      <GiveDiscountDialog open={open} onOpenChange={setOpen} student={{ id: studentId, name: studentName }} studentGroups={groups} />
    </Card>
  )
}
