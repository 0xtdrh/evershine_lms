'use client'

import { useState } from 'react'
import { useSession } from 'next-auth/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { AccessDenied } from '@/components/AccessDenied'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AlertTriangle, Loader2, Trash2 } from 'lucide-react'

const norm = (v: string) => v.normalize('NFKC').replace(new RegExp(`[${String.fromCharCode(0x0640)}${String.fromCharCode(0x200b)}-${String.fromCharCode(0x200f)}]`, 'g'), '').replace(/\s+/g, ' ').trim()

interface Row { table: string; toDelete: number; kept: number }
interface Preview { ready: boolean; reason?: string; rows: Row[]; totalToDelete: number; confirmation: string }

export default function WipeTestDataPage() {
  const { data: session, status } = useSession()
  const isSuperAdmin = session?.user?.role === 'SUPER_ADMIN'
  const qc = useQueryClient()
  const [typed, setTyped] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['wipe-preview'],
    queryFn: () => fetchApi<Preview>('/api/admin/wipe-test-data'),
    enabled: isSuperAdmin,
  })
  const wipe = useMutation({
    mutationFn: () =>
      fetchApi<{ backupFile: string; deleted: Record<string, number> }>('/api/admin/wipe-test-data', {
        method: 'POST',
        body: JSON.stringify({ confirm: typed }),
      }),
    onSuccess: (r) => {
      notify.success('Test data deleted', { description: `Backup taken first: ${r.backupFile}` })
      setTyped('')
      qc.invalidateQueries()
    },
    onError: (err: Error) => notify.error(err.message || 'Nothing was deleted'),
  })

  if (status === 'loading') return null
  if (!isSuperAdmin) return <AccessDenied />

  const rows = (data?.rows ?? []).filter((r) => r.toDelete > 0 || r.kept > 0)
  const deleting = rows.filter((r) => r.toDelete > 0)
  const keeping = rows.filter((r) => r.kept > 0)

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold"><Trash2 className="h-6 w-6" /> Delete test data</h1>
        <p className="text-sm text-muted-foreground">
          One-time cleanup before going live. A backup is taken automatically first; if anything goes wrong, nothing is deleted.
        </p>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !data?.ready ? (
        <p className="text-sm text-red-600">{data?.reason}</p>
      ) : (
        <>
          <Card className="border-red-300">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-red-700"><AlertTriangle className="h-5 w-5" /> {data.totalToDelete} rows will be deleted</CardTitle>
              <CardDescription>
                Kept: Super Admin accounts, TechNova Company + batch General, the 5 Nova tracks with their levels, and settings (permissions, certificate designs, feedback questions).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
                {deleting.map((r) => (
                  <div key={r.table} className="flex justify-between rounded border px-2 py-1">
                    <span className="truncate">{r.table}</span>
                    <span className="font-mono text-red-700">−{r.toDelete}{r.kept > 0 ? ` (keeps ${r.kept})` : ''}</span>
                  </div>
                ))}
              </div>
              <div className="space-y-2">
                <p className="text-sm">
                  To confirm, type exactly: <strong className="select-all">{data.confirmation}</strong>
                </p>
                <Input dir="rtl" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={data.confirmation} />
                <Button
                  variant="destructive"
                  disabled={norm(typed) !== norm(data.confirmation) || wipe.isPending}
                  onClick={() => wipe.mutate()}
                >
                  {wipe.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Back up, then delete all test data
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Kept</CardTitle></CardHeader>
            <CardContent className="grid gap-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
              {keeping.map((r) => (
                <div key={r.table} className="flex justify-between rounded border px-2 py-1">
                  <span className="truncate">{r.table}</span>
                  <span className="font-mono text-emerald-700">{r.kept}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
