'use client'

/** LMS settings: how lessons open (company default + per level), watermark, kid mode age. Groups can override on their lesson panel. */

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { checkPermission } from '@/lib/rbac'
import { AccessDenied } from '@/components/AccessDenied'
import { MODE_LABELS } from '@/components/lms/GroupLessonsPanel'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { GraduationCap, Loader2 } from 'lucide-react'
import Link from 'next/link'
import { PolicyForm, type Policy } from '@/components/assignments/PolicyForm'

interface Settings { unlockMode: string; watermark: boolean; kidModeMaxAge: number }
interface Data { settings: Settings; modes: string[]; levels: { id: string; name: string; mode: string | null }[] }

function HomeworkRules({ canEdit, levels }: { canEdit: boolean; levels: { id: string; name: string }[] }) {
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['hw-policies'], queryFn: () => fetchApi<{ company: Policy; levels: Record<string, Policy> }>('/api/assignments/policies') })
  const [level, setLevel] = useState<string>('')
  const save = useMutation({
    mutationFn: (b: object) => fetchApi('/api/assignments/policies', { method: 'PUT', body: JSON.stringify(b) }),
    onSuccess: () => { notify.success('Saved'); qc.invalidateQueries({ queryKey: ['hw-policies'] }) },
    onError: (e: Error) => notify.error(e.message),
  })
  if (!data) return <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">Homework rules</CardTitle><CardDescription>Late hand-ins, penalty, handing in again, extra days after an excused absence. A level or a single group (Grade homework page) can have its own.</CardDescription></CardHeader>
      <CardContent className="space-y-4">
        {canEdit ? <PolicyForm key={JSON.stringify(data.company)} value={data.company} onSave={(p) => save.mutate({ company: p })} /> : <p className="text-sm text-slate-500">{JSON.stringify(data.company)}</p>}
        {canEdit && (
          <div className="space-y-2 border-t border-slate-100 pt-3">
            <Select value={level} onValueChange={setLevel}>
              <SelectTrigger className="h-9 w-80"><SelectValue placeholder="Own rules for one level…" /></SelectTrigger>
              <SelectContent>{levels.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}{data.levels[l.id] ? ' (own rules)' : ''}</SelectItem>)}</SelectContent>
            </Select>
            {level && <PolicyForm key={level} value={data.levels[level] ?? data.company} onSave={(p) => save.mutate({ level: { id: level, policy: p } })} onReset={data.levels[level] ? () => save.mutate({ level: { id: level, policy: null } }) : undefined} />}
          </div>
        )}
        <Link href="/dashboard/admin/rubrics" className="text-sm text-indigo-600 underline">Rubric library →</Link>
      </CardContent>
    </Card>
  )
}

export default function LmsSettingsPage() {
  const { data: session } = useSession()
  const role = session?.user?.role
  const allowed = !!role && checkPermission(role, 'curriculum', 'read')
  const canEdit = !!role && checkPermission(role, 'curriculum', 'approve')
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['lms-settings'], queryFn: () => fetchApi<Data>('/api/lessons/settings'), enabled: allowed })
  const [f, setF] = useState<Settings | null>(null)
  useEffect(() => { if (data) setF(data.settings) }, [data])
  const save = useMutation({
    mutationFn: (body: object) => fetchApi('/api/lessons/settings', { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: () => { notify.success('Saved'); qc.invalidateQueries({ queryKey: ['lms-settings'] }) },
    onError: (e: Error) => notify.error(e.message),
  })
  if (!role) return null
  if (!allowed) return <AccessDenied title="LMS settings" message="You don't have access to the LMS settings." />
  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900"><GraduationCap className="h-7 w-7 text-indigo-600" /> LMS settings</h1>
        <p className="mt-1 text-sm text-slate-500">How lessons open for students and how content is protected. Students see lessons only while the LMS is switched on in Platform.</p>
      </div>
      {!data || !f ? <Loader2 className="h-5 w-5 animate-spin text-slate-400" /> : (
        <>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Company default</CardTitle><CardDescription>Used by every level and group that has no choice of its own.</CardDescription></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <label className="flex flex-wrap items-center gap-2">How lessons open
                <Select value={f.unlockMode} onValueChange={(v) => setF({ ...f, unlockMode: v })} disabled={!canEdit}>
                  <SelectTrigger className="h-9 w-80"><SelectValue /></SelectTrigger>
                  <SelectContent>{data.modes.map((m) => <SelectItem key={m} value={m}>{MODE_LABELS[m]}</SelectItem>)}</SelectContent>
                </Select>
              </label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={f.watermark} disabled={!canEdit} onChange={(e) => setF({ ...f, watermark: e.target.checked })} /> Student&apos;s name as a watermark on lesson content</label>
              <label className="flex items-center gap-2">Kid mode (big, one item per screen, read-aloud) up to age <Input type="number" min={0} max={18} className="h-8 w-20" value={f.kidModeMaxAge} disabled={!canEdit} onChange={(e) => setF({ ...f, kidModeMaxAge: Number(e.target.value) || 0 })} /></label>
              {canEdit && <Button onClick={() => save.mutate({ settings: f })} disabled={save.isPending}>{save.isPending && <Loader2 className="me-2 h-4 w-4 animate-spin" />}Save</Button>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Per level</CardTitle><CardDescription>A level can open its lessons differently. A single group can still be changed from its lesson plan (attendance screen).</CardDescription></CardHeader>
            <CardContent className="space-y-1 text-sm">
              {data.levels.map((l) => (
                <div key={l.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 px-3 py-1.5">
                  <span>{l.name}</span>
                  <Select value={l.mode ?? 'DEFAULT'} onValueChange={(v) => save.mutate({ level: { id: l.id, mode: v === 'DEFAULT' ? null : v } })} disabled={!canEdit}>
                    <SelectTrigger className="h-8 w-72 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="DEFAULT">Company default</SelectItem>
                      {data.modes.map((m) => <SelectItem key={m} value={m}>{MODE_LABELS[m]}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </CardContent>
          </Card>
          <HomeworkRules canEdit={canEdit} levels={data.levels} />
        </>
      )}
    </div>
  )
}
