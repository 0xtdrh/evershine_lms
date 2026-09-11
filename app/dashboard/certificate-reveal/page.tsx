'use client'

import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { notify } from '@/lib/notify'
import { Loader2, Eye, EyeOff, Sparkles, PartyPopper } from 'lucide-react'

interface PendingCertificate {
  id: string
  title: string
  certificateNumber: string
  student: { id: string; firstName: string; lastName: string; fullNameAr?: string; profilePicture: string | null }
  subject: { id: string; name: string } | null
}

export default function CertificateRevealPage() {
  const queryClient = useQueryClient()
  const [confirmAll, setConfirmAll] = useState(false)

  const { data: pending = [], isLoading } = useQuery<PendingCertificate[]>({
    queryKey: ['certificates-pending-reveal'],
    queryFn: () => fetchApi('/api/certificates/reveal'),
  })

  const revealMutation = useMutation({
    mutationFn: (payload: { scope: 'certificate' | 'student' | 'subject' | 'all'; certificateId?: string; studentId?: string; subjectId?: string }) =>
      fetchApi('/api/certificates/reveal', { method: 'POST', body: JSON.stringify(payload) }),
    onSuccess: (res: any) => {
      queryClient.invalidateQueries({ queryKey: ['certificates-pending-reveal'] })
      notify.success(`${res.revealedCount} certificate${res.revealedCount === 1 ? '' : 's'} revealed`)
      setConfirmAll(false)
    },
    onError: () => notify.error('Failed to reveal certificates'),
  })

  const bySubject = useMemo(() => {
    const groups = new Map<string, { subjectId: string | null; subjectName: string; items: PendingCertificate[] }>()
    for (const c of pending) {
      const key = c.subject?.id ?? 'none'
      if (!groups.has(key)) groups.set(key, { subjectId: c.subject?.id ?? null, subjectName: c.subject?.name ?? 'Uncategorized', items: [] })
      groups.get(key)!.items.push(c)
    }
    return Array.from(groups.values())
  }, [pending])

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Sparkles className="w-6 h-6 text-amber-500" /> Certificate Reveal
          </h1>
          <p className="text-sm text-slate-500 mt-1">Certificates are hidden from students & parents until you reveal them — typically at the annual ceremony.</p>
        </div>
        {pending.length > 0 && (
          confirmAll ? (
            <div className="flex items-center gap-2">
              <span className="text-sm text-amber-700 font-medium">Reveal all {pending.length} pending certificates?</span>
              <Button size="sm" variant="destructive" onClick={() => revealMutation.mutate({ scope: 'all' })} disabled={revealMutation.isPending}>
                {revealMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Confirm'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmAll(false)}>Cancel</Button>
            </div>
          ) : (
            <Button className="gap-2 bg-amber-500 hover:bg-amber-600" onClick={() => setConfirmAll(true)}>
              <PartyPopper className="w-4 h-4" /> Reveal All ({pending.length})
            </Button>
          )
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>
      ) : pending.length === 0 ? (
        <Card><CardContent className="py-16 text-center text-slate-400">No certificates are waiting for reveal right now.</CardContent></Card>
      ) : (
        bySubject.map((group) => (
          <Card key={group.subjectId ?? 'none'}>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <div>
                <CardTitle className="text-base">{group.subjectName}</CardTitle>
                <CardDescription>{group.items.length} certificate{group.items.length === 1 ? '' : 's'} pending</CardDescription>
              </div>
              {group.subjectId && (
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => revealMutation.mutate({ scope: 'subject', subjectId: group.subjectId! })} disabled={revealMutation.isPending}>
                  <Eye className="w-3.5 h-3.5" /> Reveal this group
                </Button>
              )}
            </CardHeader>
            <CardContent className="divide-y divide-slate-100">
              {group.items.map((c) => (
                <div key={c.id} className="flex items-center justify-between py-2.5">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px] text-slate-400 font-mono">{c.certificateNumber}</Badge>
                    <span className="text-sm font-medium text-slate-800">{c.student.firstName} {c.student.lastName}</span>
                  </div>
                  <Button size="sm" variant="ghost" className="gap-1.5 text-xs" onClick={() => revealMutation.mutate({ scope: 'student', studentId: c.student.id })} disabled={revealMutation.isPending}>
                    <EyeOff className="w-3.5 h-3.5" /> Reveal
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        ))
      )}
    </div>
  )
}
