'use client'

/** a02 M4 batch 3 (2026-11-02): protected videos: the list, unusual watching, and the settings (devices at once, paid courses). */

import { WatchSettingsCard } from '@/components/videos/WatchSettingsCard'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { L, useI18n } from '@/lib/i18n/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useMyPermissions } from '@/hooks/use-my-permissions'
import { useUrlTab } from '@/hooks/use-url-tab'
import { ShieldCheck } from 'lucide-react'

interface VideoRow { id: string; status: string; originalName: string; durationSec: number | null; sizeBytes: number | null; pieces: number | null; viewings: number; uses: number; createdAt: string }
interface WatchRow { studentId: string; name: string; registrationNumber: string | null; sessions: number; refused: number; ips: number; devices: number; keyFetches: number }
interface Settings { deviceLimit: number; blockUnprotectedPaid: boolean }

function Videos({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient()
  const remove = useMutation({
    mutationFn: (id: string) => fetchApi(`/api/videos/${id}`, { method: 'DELETE' }),
    onSuccess: () => { notify.success(L('Removed', 'اتمسح')); qc.invalidateQueries({ queryKey: ['videos'] }) }, onError: (e: Error) => notify.error(e.message),
  })
  const { data, isLoading } = useQuery({ queryKey: ['videos'], queryFn: () => fetchApi<VideoRow[]>('/api/videos') })
  return (
    <div className="space-y-2">
      <p className="text-sm text-slate-500">{L('Upload a video from the curriculum: open a session, add a Video block, then "Upload protected video".', 'الفيديو بيترفع من المنهج: افتح الحصة، ضيف بلوك فيديو، ودوس «ارفع فيديو محمي».')}</p>
      {isLoading && <p className="text-sm text-slate-500">{L('Loading…', 'بيحمّل…')}</p>}
      {data && !data.length && <p className="py-8 text-center text-sm text-slate-500">{L('No protected videos yet.', 'لسه مفيش فيديوهات محمية.')}</p>}
      {(data ?? []).map((v) => (
        <div key={v.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 p-3 text-sm">
          <div className="min-w-0">
            <p className="truncate font-semibold">{v.originalName}</p>
            <p className="text-xs text-slate-500">{v.durationSec != null ? `${Math.floor(v.durationSec / 60)}:${String(v.durationSec % 60).padStart(2, '0')}` : ''}{v.sizeBytes ? ` · ${Math.round(v.sizeBytes / 1048576)} MB` : ''} · {L(`${v.viewings} viewings`, `${v.viewings} مشاهدة`)} · {v.uses ? L(`in ${v.uses} lesson(s)`, `في ${v.uses} درس`) : L('not in any lesson', 'مش في أي درس')}</p>
          </div>
          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${v.status === 'READY' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>{v.status === 'READY' ? L('Ready', 'جاهز') : L('Not finished', 'الرفع ما خلصش')}</span>
          {canEdit && !v.uses && <Button size="sm" variant="outline" disabled={remove.isPending} onClick={() => { if (window.confirm(L('Remove this video for good?', 'تمسح الفيديو ده نهائيًا؟'))) remove.mutate(v.id) }}>{L('Remove', 'امسح')}</Button>}
        </div>
      ))}
    </div>
  )
}

function Watching() {
  const { data, isLoading } = useQuery({ queryKey: ['videos-watch'], queryFn: () => fetchApi<WatchRow[]>('/api/videos/watch') })
  return (
    <div className="space-y-2">
      <p className="text-sm text-slate-500">{L('Last 7 days: many refused devices, many networks, or far more key requests than viewings. It can have an innocent reason, so check before acting.', 'آخر 7 أيام: أجهزة كتير اترفضت، أو شبكات كتير، أو طلبات مفتاح أكتر بكتير من المشاهدات. ممكن يكون ليها سبب عادي، فراجع قبل أي إجراء.')}</p>
      {isLoading && <p className="text-sm text-slate-500">{L('Loading…', 'بيحمّل…')}</p>}
      {data && !data.length && <p className="py-8 text-center text-sm text-slate-500">{L('Nothing unusual.', 'مفيش حاجة غير عادية.')}</p>}
      {(data ?? []).map((w) => (
        <div key={w.studentId} className="rounded-lg border border-slate-200 p-3 text-sm">
          <Link className="font-semibold text-indigo-700 hover:underline" href={`/dashboard/students/${w.studentId}`}>{w.name}</Link>{w.registrationNumber ? ` · ${w.registrationNumber}` : ''}
          <p className="text-xs text-slate-600">{L('Viewings', 'مشاهدات')}: {w.sessions} · {L('Refused', 'مرفوض')}: {w.refused} · {L('Devices', 'أجهزة')}: {w.devices} · {L('Networks', 'شبكات')}: {w.ips} · {L('Key requests', 'طلبات المفتاح')}: {w.keyFetches}</p>
        </div>
      ))}
    </div>
  )
}

function SettingsCard({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['videos-settings'], queryFn: () => fetchApi<Settings>('/api/videos/settings') })
  const [f, setF] = useState<Settings | null>(null)
  useEffect(() => { if (data) setF(data) }, [data])
  const save = useMutation({
    mutationFn: () => fetchApi('/api/videos/settings', { method: 'PUT', body: JSON.stringify(f) }),
    onSuccess: () => { notify.success(L('Saved', 'اتحفظ')); qc.invalidateQueries({ queryKey: ['videos-settings'] }) }, onError: (e: Error) => notify.error(e.message),
  })
  if (!f) return null
  return (
    <Card><CardContent className="space-y-3 pt-4 text-sm">
      <label className="block space-y-1"><span className="block text-xs text-slate-500">{L('Devices one student may watch on at the same time (a recorded course can set its own number)', 'عدد الأجهزة اللي الطالب يتفرج عليها في نفس الوقت (الكورس المسجل ممكن يكون له رقم خاص)')}</span>
        <Input type="number" min={1} max={10} className="h-9 w-24" disabled={!canEdit} value={f.deviceLimit} onChange={(e) => setF({ ...f, deviceLimit: Number(e.target.value) })} /></label>
      <label className="flex items-center gap-2 text-xs"><input type="checkbox" disabled={!canEdit} checked={f.blockUnprotectedPaid} onChange={(e) => setF({ ...f, blockUnprotectedPaid: e.target.checked })} /> {L('A paid recorded course refuses enrolling while it has an unprotected video (YouTube link or old file)', 'الكورس المسجل المدفوع يرفض التسجيل طول ما فيه فيديو مش محمي (لينك YouTube أو ملف قديم)')}</label>
      {canEdit && <Button disabled={save.isPending} onClick={() => save.mutate()}>{L('Save', 'احفظ')}</Button>}
    </CardContent></Card>
  )
}

export default function VideosPage() {
  useI18n()
  const { can, role } = useMyPermissions()
  const [tab, setTab] = useUrlTab()
  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold"><ShieldCheck className="h-5 w-5 text-indigo-600" /> {L('Protected videos', 'الفيديوهات المحمية')}</h1>
        <p className="text-sm text-slate-500">{L('Encrypted lesson videos with the viewer’s name on the picture and a limit on devices.', 'فيديوهات دروس متشفرة، عليها اسم المشاهد، وبحد لعدد الأجهزة.')}</p>
      </div>
      <Tabs value={tab ?? 'list'} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="list">{L('Videos', 'الفيديوهات')}</TabsTrigger>
          <TabsTrigger value="watch">{L('Unusual watching', 'مشاهدة غير عادية')}</TabsTrigger>
          <TabsTrigger value="settings">{L('Settings', 'الإعدادات')}</TabsTrigger>
        </TabsList>
        <TabsContent value="list" className="mt-4"><Videos canEdit={can('video_protection', 'update')} /></TabsContent>
        <TabsContent value="watch" className="mt-4"><Watching /></TabsContent>
        <TabsContent value="settings" className="mt-4 space-y-4"><SettingsCard canEdit={can('video_protection', 'update')} /><WatchSettingsCard canEdit={role === 'SUPER_ADMIN' || role === 'ADMIN'} /></TabsContent>
      </Tabs>
    </div>
  )
}
