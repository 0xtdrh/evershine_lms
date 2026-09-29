'use client'

import { useSession } from 'next-auth/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { AccessDenied } from '@/components/AccessDenied'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { CheckCircle2, Circle, Loader2, Wand2 } from 'lucide-react'

interface Step { key: string; title: string; status: 'DONE' | 'TODO'; detail: string }

export default function InitialSetupPage() {
  const { data: session, status } = useSession()
  const isSuperAdmin = session?.user?.role === 'SUPER_ADMIN'
  const qc = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['initial-setup'],
    queryFn: () => fetchApi<{ steps: Step[] }>('/api/admin/setup'),
    enabled: isSuperAdmin,
  })
  const apply = useMutation({
    mutationFn: () => fetchApi<{ steps: Step[] }>('/api/admin/setup', { method: 'POST' }),
    onSuccess: () => {
      notify.success('Setup applied')
      qc.invalidateQueries()
    },
    onError: (err: Error) => notify.error(err.message || 'Setup failed'),
  })

  if (status === 'loading') return null
  if (!isSuperAdmin) return <AccessDenied />

  const steps = data?.steps ?? []
  const todo = steps.filter((s) => s.status === 'TODO').length

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold"><Wand2 className="h-6 w-6" /> Initial Setup</h1>
          <p className="text-sm text-muted-foreground">
            Sets TechNova&apos;s base data. Review the list, then apply. Safe to run again: finished steps are skipped.
          </p>
        </div>
        <Button onClick={() => apply.mutate()} disabled={apply.isPending || isLoading || todo === 0}>
          {apply.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {todo === 0 ? 'Everything is set up' : `Apply ${todo} step(s)`}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>What will be set</CardTitle>
          <CardDescription>Take a backup first (Admin → Backups → Back up now).</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <div className="divide-y rounded-md border">
              {steps.map((s) => (
                <div key={s.key} className="flex items-start gap-3 p-3">
                  {s.status === 'DONE'
                    ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
                    : <Circle className="mt-0.5 h-5 w-5 shrink-0 text-slate-400" />}
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{s.title}</p>
                    <p className="text-xs text-muted-foreground">{s.detail}</p>
                  </div>
                  <Badge variant={s.status === 'DONE' ? 'secondary' : 'outline'}>{s.status === 'DONE' ? 'Done' : 'To do'}</Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
