'use client'

import { useState } from 'react'
import { useSession } from 'next-auth/react'
import { useQuery } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ArrowRightLeft } from 'lucide-react'
import { TransferStudentDialog } from '@/components/groups/TransferStudentDialog'

interface TransferRow {
  id: string
  createdAt: string
  from: { label: string; course: string | null; level: string | null } | null
  to: { label: string; course: string | null; level: string | null } | null
  sessionsCounted: number
  consumedAmount: number
  creditAmount: number
  creditTo: 'NEW_INVOICE' | 'WALLET'
  creditApplied: number
  cancelledAmount: number
  reason: string | null
  by: string | null
}

const money = (n: number) => `${n.toLocaleString('en-US', { maximumFractionDigits: 2 })} EGP`
const name = (g: TransferRow['from']) => (g ? `${g.label}${g.course ? ` (${g.course}${g.level ? ` · ${g.level}` : ''})` : ''}` : '—')

/** The student's current groups with a "Move" button, and every move made so far. */
export function StudentTransferCard({ studentId, studentName, groups }: { studentId: string; studentName: string; groups: { id: string; name: string }[] }) {
  const { data: session, status } = useSession()
  const role = session?.user?.role
  const [fromId, setFromId] = useState<string | null>(null)
  const { data: perms } = useQuery({
    queryKey: ['my-permissions', role],
    queryFn: () => fetchApi<{ permissions: Record<string, string[]> }>('/api/me/permissions'),
    staleTime: 60_000,
    enabled: status === 'authenticated' && !!role,
  })
  const canRead = !!perms?.permissions?.group_transfers?.includes('read')
  const canMove = !!perms?.permissions?.group_transfers?.includes('create')
  const { data: history } = useQuery({
    queryKey: ['student-transfers', studentId],
    queryFn: () => fetchApi<TransferRow[]>(`/api/students/${studentId}/transfer`),
    enabled: canRead,
  })
  if (!canRead) return null

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm"><ArrowRightLeft className="h-4 w-4" /> Groups &amp; moves</CardTitle>
        <CardDescription>Move the student to another group: the money and discounts move with them.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {groups.length === 0 ? (
          <p className="text-slate-500">Not in any group right now.</p>
        ) : (
          groups.map((g) => (
            <div key={g.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2">
              <span className="text-slate-800">{g.name}</span>
              {canMove && (
                <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={() => setFromId(g.id)}>
                  <ArrowRightLeft className="h-3.5 w-3.5" /> Move
                </Button>
              )}
            </div>
          ))
        )}
        {(history?.length ?? 0) > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Moves</p>
            {history!.map((t) => (
              <div key={t.id} className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                <p className="font-medium text-slate-800">{name(t.from)} → {name(t.to)}</p>
                <p>
                  {new Date(t.createdAt).toLocaleDateString('en-GB')} · {t.sessionsCounted} session(s) kept ({money(t.consumedAmount)})
                  {t.creditAmount > 0 && ` · credit ${money(t.creditAmount)} → ${t.creditTo === 'NEW_INVOICE' ? `new invoice (${money(t.creditApplied)})` : 'wallet'}`}
                  {t.cancelledAmount > 0 && ` · ${money(t.cancelledAmount)} cancelled`}
                  {t.by && ` · by ${t.by}`}
                </p>
                {t.reason && <p className="italic">{t.reason}</p>}
              </div>
            ))}
          </div>
        )}
      </CardContent>
      {fromId && (
        <TransferStudentDialog
          open={!!fromId}
          onOpenChange={(o) => { if (!o) setFromId(null) }}
          studentId={studentId}
          studentName={studentName}
          fromGroupId={fromId}
        />
      )}
    </Card>
  )
}
