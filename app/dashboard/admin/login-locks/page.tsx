'use client'

import { useSession } from 'next-auth/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { AccessDenied } from '@/components/AccessDenied'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { LockKeyhole, Loader2, RefreshCw } from 'lucide-react'

interface Lock { kind: 'account' | 'ip'; value: string; failures: number; lockedUntil: string }
interface Data { locks: Lock[]; rules: { lockMinutes: number; maxFailsPerAccount: number; maxFailsPerIp: number } }

export default function LoginLocksPage() {
  const { data: session, status } = useSession()
  const isSuperAdmin = session?.user?.role === 'SUPER_ADMIN'
  const qc = useQueryClient()

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['login-locks'],
    queryFn: () => fetchApi<Data>('/api/admin/login-locks'),
    enabled: isSuperAdmin,
  })
  const unlock = useMutation({
    mutationFn: (l: Lock) =>
      fetchApi('/api/admin/login-locks', { method: 'POST', body: JSON.stringify({ kind: l.kind, value: l.value }) }),
    onSuccess: () => {
      notify.success('Unlocked')
      qc.invalidateQueries({ queryKey: ['login-locks'] })
    },
    onError: (err: Error) => notify.error(err.message || 'Could not unlock'),
  })

  if (status === 'loading') return null
  if (!isSuperAdmin) return <AccessDenied />

  const locks = data?.locks ?? []
  const r = data?.rules

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold"><LockKeyhole className="h-6 w-6" /> Login locks</h1>
          {r && (
            <p className="text-sm text-muted-foreground">
              Sign-in pauses for {r.lockMinutes} minutes after {r.maxFailsPerAccount} wrong passwords on one account,
              or {r.maxFailsPerIp} from one device (IP). It unlocks by itself; unlock early here if a real user is waiting.
            </p>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} /> Refresh
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Locked right now</CardTitle>
          <CardDescription>A parent&apos;s account appears as their login email (guardian_&lt;phone&gt;@…).</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : locks.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing is locked.</p>
          ) : (
            <div className="space-y-2">
              {locks.map((l) => (
                <div key={`${l.kind}:${l.value}`} className="flex flex-wrap items-center justify-between gap-2 rounded border px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <span className="mr-2 rounded bg-muted px-1.5 py-0.5 text-xs uppercase">{l.kind === 'ip' ? 'Device (IP)' : 'Account'}</span>
                    <span className="break-all font-mono">{l.value}</span>
                    <div className="text-xs text-muted-foreground">
                      {l.failures} wrong attempts · until about {new Date(l.lockedUntil).toLocaleTimeString()}
                    </div>
                  </div>
                  <Button size="sm" onClick={() => unlock.mutate(l)} disabled={unlock.isPending}>
                    {unlock.isPending && unlock.variables?.value === l.value && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Unlock
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
