'use client'

import { dmyTime } from '@/lib/format/dates'
import { useSession } from 'next-auth/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { AccessDenied } from '@/components/AccessDenied'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { notify } from '@/lib/notify'
import { DatabaseBackup, Download, Loader2, RefreshCw } from 'lucide-react'
import { L, useI18n } from '@/lib/i18n/client'

interface StoredBackup {
  id: string
  fileName: string
  bytes: number
  createdAt: string
}

interface RunResult {
  backup: StoredBackup
  tables: number
  totalRows: number
  durationMs: number
  deleted: string[]
}

function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

const formatDate = (value: string) => dmyTime(value)

export default function BackupsPage() {
  useI18n() // re-render on a language switch
  const { status, data: session } = useSession()
  const queryClient = useQueryClient()
  const isSuperAdmin = session?.user?.role === 'SUPER_ADMIN'

  const backupsQuery = useQuery({
    queryKey: ['admin-backups'],
    queryFn: () => fetchApi<{ backups: StoredBackup[]; keep: number }>('/api/admin/backups'),
    enabled: isSuperAdmin,
  })

  const runMutation = useMutation({
    mutationFn: () => fetchApi<RunResult>('/api/admin/backups', { method: 'POST' }),
    onSuccess: (result) => {
      notify.success(L(`Backup created: ${result.tables} tables, ${result.totalRows} rows`, `النسخة اتعملت: ${result.tables} جدول، ${result.totalRows} صف`))
      queryClient.invalidateQueries({ queryKey: ['admin-backups'] })
    },
    onError: (err: Error) => notify.error(err.message || 'Backup failed'),
  })

  if (status === 'loading') return null
  if (!isSuperAdmin) return <AccessDenied />

  const backups = backupsQuery.data?.backups ?? []
  const latest = backups[0]
  const latestAgeHours = latest ? (Date.now() - new Date(latest.createdAt).getTime()) / 36e5 : null

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <DatabaseBackup className="h-6 w-6" /> {L('Database Backups', 'النسخ الاحتياطي')}
          </h1>
          <p className="text-sm text-muted-foreground">
            {L('Automatic daily backup (about 3–4 AM Cairo time). The newest', 'نسخة احتياطي تلقائي كل يوم (حوالي 3–4 الفجر بتوقيت القاهرة). آخر')} {backupsQuery.data?.keep ?? 7} {L('are kept.', 'بيتحفظوا.')}
          </p>
        </div>
        <Button onClick={() => runMutation.mutate()} disabled={runMutation.isPending}>
          {runMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          {runMutation.isPending ? L('Backing up…', 'بياخد نسخة…') : L('Back up now', 'خد نسخة دلوقتي')}
        </Button>
      </div>

      {latestAgeHours !== null && latestAgeHours > 26 && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {L('The latest backup is', 'آخر نسخة عمرها')} {Math.floor(latestAgeHours)} {L('hours old. The daily backup may be failing.', 'ساعة. ممكن النسخة اليومية بتفشل.')}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{L('Stored backups', 'النسخ المحفوظة')}</CardTitle>
          <CardDescription>
            {L('Each file is a complete gzipped SQL dump. It contains personal data: keep downloaded copies private.', 'كل ملف نسخة كاملة من قاعدة البيانات. فيه بيانات شخصية: خلّي النسخ اللي بتنزّلها في مكان آمن.')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {backupsQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">{L('Loading…', 'بيحمّل…')}</p>
          ) : backupsQuery.isError ? (
            <p className="text-sm text-red-600">{(backupsQuery.error as Error).message}</p>
          ) : backups.length === 0 ? (
            <p className="text-sm text-muted-foreground">{L('No backups yet. Press “Back up now”.', 'لسه مفيش نسخ. دوس «خد نسخة دلوقتي».')}</p>
          ) : (
            <div className="divide-y rounded-md border">
              {backups.map((b) => (
                <div key={b.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{formatDate(b.createdAt)}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {b.fileName} · {formatSize(b.bytes)}
                      {b.fileName.includes('-manual') ? L(' · manual', ' · يدوي') : L(' · automatic', ' · تلقائي')}
                    </p>
                  </div>
                  <Button asChild variant="outline" size="sm">
                    <a href={`/api/admin/backups/download?id=${encodeURIComponent(b.id)}`}>
                      <Download className="mr-2 h-4 w-4" /> {L('Download', 'تنزيل')}
                    </a>
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
