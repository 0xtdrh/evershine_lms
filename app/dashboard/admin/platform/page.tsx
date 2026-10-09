'use client'

/** Platform: master switches for whole modules + the default language for staff and for the portal. */

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { checkPermission } from '@/lib/rbac'
import { AccessDenied } from '@/components/AccessDenied'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Loader2, Power } from 'lucide-react'

interface Data { modules: Record<string, boolean>; language: { staff: 'en' | 'ar'; portal: 'en' | 'ar' }; catalog: { key: string; label: string; labelAr: string }[] }

export default function PlatformPage() {
  const { data: session } = useSession()
  const role = session?.user?.role
  const allowed = !!role && checkPermission(role, 'platform_settings', 'read')
  const canEdit = !!role && checkPermission(role, 'platform_settings', 'update')
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['platform-settings'], queryFn: () => fetchApi<Data>('/api/platform/settings'), enabled: allowed })
  const [modules, setModules] = useState<Record<string, boolean>>({})
  const [language, setLanguage] = useState<Data['language']>({ staff: 'en', portal: 'en' })
  useEffect(() => { if (data) { setModules(data.modules); setLanguage(data.language) } }, [data])
  const save = useMutation({
    mutationFn: () => fetchApi('/api/platform/settings', { method: 'PUT', body: JSON.stringify({ modules, language }) }),
    onSuccess: () => { notify.success('Saved'); qc.invalidateQueries({ queryKey: ['platform-settings'] }) },
    onError: (e: Error) => notify.error(e.message),
  })
  if (!role) return null
  if (!allowed) return <AccessDenied title="Platform" message="You don't have access to the platform settings." />
  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900"><Power className="h-7 w-7 text-indigo-600" /> Platform</h1>
        <p className="mt-1 text-sm text-slate-500">Switch whole parts of TechNova on or off — turn them on step by step at launch, or off at once if something goes wrong. Data is never deleted by switching off.</p>
      </div>
      {!data ? <Loader2 className="h-5 w-5 animate-spin text-slate-400" /> : (
        <>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Modules</CardTitle><CardDescription>Modules that are still being built stay off until they are ready.</CardDescription></CardHeader>
            <CardContent className="divide-y divide-slate-100">
              {data.catalog.map((m) => (
                <label key={m.key} className="flex cursor-pointer items-center justify-between gap-3 py-2.5">
                  <span><span className="block text-sm font-medium text-slate-800">{m.label}</span><span className="block text-xs text-slate-500" dir="rtl">{m.labelAr}</span></span>
                  <input type="checkbox" className="h-5 w-5 accent-indigo-600" checked={!!modules[m.key]} disabled={!canEdit} onChange={(e) => setModules({ ...modules, [m.key]: e.target.checked })} />
                </label>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Default language</CardTitle><CardDescription>Used until a person picks a language with the EN / عربي button in the header.</CardDescription></CardHeader>
            <CardContent className="flex flex-wrap gap-4 text-sm">
              {(['staff', 'portal'] as const).map((k) => (
                <label key={k} className="flex items-center gap-2">
                  {k === 'staff' ? 'Staff' : 'Parents & students'}
                  <Select value={language[k]} onValueChange={(v) => setLanguage({ ...language, [k]: v as 'en' | 'ar' })} disabled={!canEdit}>
                    <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="en">English</SelectItem><SelectItem value="ar">العربية</SelectItem></SelectContent>
                  </Select>
                </label>
              ))}
            </CardContent>
          </Card>
          {canEdit && <Button onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save</Button>}
        </>
      )}
    </div>
  )
}
