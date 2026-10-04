'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Gift } from 'lucide-react'

interface Ref { id: string; code: string; status: string; reward: number; createdAt: string; referrer: { name: string; phone: string } | null }

/** Phase D: who referred this student; link one by code or the referrer's phone. */
export function StudentReferralCard({ studentId, canLink }: { studentId: string; canLink: boolean }) {
  const qc = useQueryClient()
  const [value, setValue] = useState('')
  const { data, isLoading } = useQuery({ queryKey: ['student-referral', studentId], queryFn: () => fetchApi<Ref | null>(`/api/referrals?studentId=${studentId}`) })
  const link = useMutation({
    mutationFn: () => fetchApi('/api/referrals', { method: 'POST', body: JSON.stringify({ studentId, codeOrPhone: value }) }),
    onSuccess: () => { notify.success('Referral linked'); setValue(''); qc.invalidateQueries({ queryKey: ['student-referral', studentId] }) },
    onError: (e: Error) => notify.error(e.message),
  })
  if (isLoading) return null
  if (!data && !canLink) return null
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><Gift className="h-4 w-4 text-indigo-600" /> Referral</CardTitle></CardHeader>
      <CardContent className="text-sm">
        {data ? (
          <p>
            Referred by <strong>{data.referrer?.name ?? '—'}</strong> ({data.referrer?.phone}) · code {data.code} ·{' '}
            {data.status === 'REWARDED' ? (data.reward ? `reward ${data.reward} EGP given` : 'done (no reward was switched on)') : 'reward when the first invoice is paid'}
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Input className="h-8 w-64" placeholder="Referral code (TN-REF-…) or parent phone" value={value} onChange={(e) => setValue(e.target.value)} />
            <Button size="sm" className="h-8" disabled={value.trim().length < 3 || link.isPending} onClick={() => link.mutate()}>Link</Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
