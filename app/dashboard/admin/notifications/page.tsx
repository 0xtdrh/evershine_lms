'use client'

/** Phase C: switch each notification type on or off for everyone. */

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { checkPermission } from '@/lib/rbac'
import { AccessDenied } from '@/components/AccessDenied'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { BellRing, Loader2 } from 'lucide-react'

interface Event { key: string; label: string; description: string; audience: 'PARENT' | 'STAFF'; on: boolean }

export default function NotificationSettingsPage() {
  const { data: session } = useSession()
  const role = session?.user?.role
  const allowed = !!role && checkPermission(role, 'notification_settings', 'read')
  const canEdit = !!role && checkPermission(role, 'notification_settings', 'update')
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['notification-settings'], queryFn: () => fetchApi<{ whatsappAuto: boolean; events: Event[] }>('/api/notifications/settings'), enabled: allowed })
  const [on, setOn] = useState<Record<string, boolean>>({})
  useEffect(() => { if (data) setOn(Object.fromEntries(data.events.map((e) => [e.key, e.on]))) }, [data])
  const save = useMutation({
    mutationFn: () => fetchApi('/api/notifications/settings', { method: 'PUT', body: JSON.stringify({ switches: on }) }),
    onSuccess: () => { notify.success('Notification settings saved'); qc.invalidateQueries({ queryKey: ['notification-settings'] }) },
    onError: (e: Error) => notify.error(e.message),
  })
  if (!role) return null
  if (!allowed) return <AccessDenied title="Notifications" message="You don't have access to notification settings." />
  const section = (aud: Event['audience'], title: string, desc: string) => (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">{title}</CardTitle><CardDescription>{desc}</CardDescription></CardHeader>
      <CardContent className="divide-y divide-slate-100">
        {(data?.events ?? []).filter((e) => e.audience === aud).map((e) => (
          <label key={e.key} className="flex cursor-pointer items-center justify-between gap-3 py-2.5">
            <span><span className="block text-sm font-medium text-slate-800">{e.label}</span><span className="block text-xs text-slate-500">{e.description}</span></span>
            <input type="checkbox" className="h-5 w-5 accent-indigo-600" checked={on[e.key] ?? true} disabled={!canEdit} onChange={(ev) => setOn({ ...on, [e.key]: ev.target.checked })} />
          </label>
        ))}
      </CardContent>
    </Card>
  )
  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900"><BellRing className="h-7 w-7 text-indigo-600" /> Notifications</h1>
        <p className="mt-1 text-sm text-slate-500">
          Turn each notification on or off for everyone. Parents cannot turn them off themselves.
          {data && (data.whatsappAuto ? ' WhatsApp is connected: parent notifications also go to WhatsApp.' : ' WhatsApp is not connected yet: notifications appear in the portal (the bell); WhatsApp starts automatically once it is set up.')}
        </p>
      </div>
      {!data ? <Loader2 className="h-5 w-5 animate-spin text-slate-400" /> : (
        <>
          {section('PARENT', 'To parents and students', 'Shown in the portal bell (and WhatsApp once connected).')}
          {section('STAFF', 'To staff', 'Shown in the staff bell.')}
          {canEdit && <Button onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save</Button>}
        </>
      )}
    </div>
  )
}
