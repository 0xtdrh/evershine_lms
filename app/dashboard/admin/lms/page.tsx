'use client'

/** LMS settings: how lessons open (company default + per level), watermark, kid mode age. Groups can override on their lesson panel. */

import { useMyPermissions } from '@/hooks/use-my-permissions'
import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { AccessDenied } from '@/components/AccessDenied'
import { modeLabel } from '@/components/lms/GroupLessonsPanel'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { GraduationCap, Loader2 } from 'lucide-react'
import Link from 'next/link'
import { PolicyForm, type Policy } from '@/components/assignments/PolicyForm'
import { L, useI18n } from '@/lib/i18n/client'

import { TOOL_CATALOG, TOOL_CATEGORIES, type ExtraSite } from '@/lib/lms/tools'
import { Plus, Trash2 } from 'lucide-react'

interface Settings { unlockMode: string; watermark: boolean; kidModeMaxAge: number; gateUngradedOpensAfterDays?: number | null; instructorStudentUnlock?: boolean }

/** L5: the tools list (built-in, read-only) + sites the admin adds. */
function ToolsCard({ canEdit }: { canEdit: boolean }) {
  const { locale } = useI18n()
  const ar = locale === 'ar'
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['lms-tools'], queryFn: () => fetchApi<{ extra: ExtraSite[] }>('/api/lms/tools') })
  const [rows, setRows] = useState<ExtraSite[] | null>(null)
  useEffect(() => { if (data) setRows(data.extra) }, [data])
  const save = useMutation({
    mutationFn: () => fetchApi('/api/lms/tools', { method: 'PUT', body: JSON.stringify({ extra: rows }) }),
    onSuccess: () => { notify.success(L('Saved', 'اتحفظ')); qc.invalidateQueries({ queryKey: ['lms-tools'] }) },
    onError: (e: Error) => notify.error(e.message),
  })
  const set = (i: number, p: Partial<ExtraSite>) => setRows((xs) => (xs ?? []).map((x, j) => (j === i ? { ...x, ...p } : x)))
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">{L('Tools', 'الأدوات')}</CardTitle><CardDescription>{L('Tools a lesson can use. ↗ = the site refuses to be shown inside another site, so it opens in a new tab. You can add more sites below.', 'الأدوات اللي الدرس يقدر يستخدمها. ↗ = الموقع مابيسمحش يتفتح جوه موقع تاني، فبيتفتح في تاب جديد. تقدر تضيف مواقع تانية تحت.')}</CardDescription></CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="space-y-1">
          {Object.entries(TOOL_CATEGORIES).filter(([c]) => c !== 'OTHER').map(([c, label]) => (
            <p key={c} className="text-xs"><span className="font-semibold text-slate-600">{ar ? label.ar : label.en}:</span> <span className="text-slate-500">{TOOL_CATALOG.filter((t) => t.category === c).map((t) => `${ar ? t.nameAr : t.nameEn}${t.mode === 'NEW_TAB' ? ' ↗' : ''}`).join('، ')}</span></p>
          ))}
        </div>
        <div className="space-y-2">
          <p className="font-medium">{L('Sites you added', 'مواقع انت ضفتها')}</p>
          {(rows ?? []).map((r, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <Input className="h-8 w-56" placeholder="example.com" value={r.host} disabled={!canEdit} onChange={(e) => set(i, { host: e.target.value })} />
              <Input className="h-8 w-40" placeholder={L('Name (English)', 'الاسم (إنجليزي)')} value={r.nameEn} disabled={!canEdit} onChange={(e) => set(i, { nameEn: e.target.value })} />
              <Input className="h-8 w-40" dir="rtl" placeholder="الاسم (عربي)" value={r.nameAr} disabled={!canEdit} onChange={(e) => set(i, { nameAr: e.target.value })} />
              <Select value={r.mode} onValueChange={(v) => set(i, { mode: v as ExtraSite['mode'] })} disabled={!canEdit}>
                <SelectTrigger className="h-8 w-48 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="INLINE">{L('Inside the lesson', 'جوه الدرس')}</SelectItem><SelectItem value="NEW_TAB">{L('New tab ↗', 'تاب جديد ↗')}</SelectItem></SelectContent>
              </Select>
              {canEdit && <Button type="button" size="sm" variant="ghost" onClick={() => setRows((xs) => (xs ?? []).filter((_, j) => j !== i))}><Trash2 className="h-4 w-4 text-rose-500" /></Button>}
            </div>
          ))}
          {canEdit && <div className="flex gap-2">
            <Button type="button" size="sm" variant="outline" className="gap-1" onClick={() => setRows((xs) => [...(xs ?? []), { host: '', nameEn: '', nameAr: '', mode: 'INLINE' }])}><Plus className="h-4 w-4" /> {L('Site', 'موقع')}</Button>
            <Button type="button" size="sm" disabled={save.isPending || (rows ?? []).some((r) => !r.host.trim() || !r.nameEn.trim())} onClick={() => save.mutate()}>{L('Save', 'حفظ')}</Button>
          </div>}
          <p className="text-[11px] text-slate-400">{L('Only add sites you trust: an "inside the lesson" site runs inside the student page frame.', 'ضيف بس مواقع موثوقة: الموقع اللي «جوه الدرس» بيشتغل جوه صفحة الطالب.')}</p>
        </div>
      </CardContent>
    </Card>
  )
}
interface Data { settings: Settings; modes: string[]; levels: { id: string; name: string; mode: string | null }[] }

function HomeworkRules({ canEdit, levels }: { canEdit: boolean; levels: { id: string; name: string }[] }) {
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['hw-policies'], queryFn: () => fetchApi<{ company: Policy; levels: Record<string, Policy> }>('/api/assignments/policies') })
  const [level, setLevel] = useState<string>('')
  const save = useMutation({
    mutationFn: (b: object) => fetchApi('/api/assignments/policies', { method: 'PUT', body: JSON.stringify(b) }),
    onSuccess: () => { notify.success(L('Saved', 'اتحفظ')); qc.invalidateQueries({ queryKey: ['hw-policies'] }) },
    onError: (e: Error) => notify.error(e.message),
  })
  if (!data) return <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">{L('Homework rules', 'قواعد الواجبات')}</CardTitle><CardDescription>{L('Late hand-ins, penalty, handing in again, extra days after an excused absence. A level or a single group (Grade homework page) can have its own.', 'التسليم المتأخر، والخصم، وإعادة التسليم، والأيام الزيادة بعد الغياب بعذر. ممكن مستوى أو جروب (من صفحة تصحيح الواجبات) يبقى له قواعده.')}</CardDescription></CardHeader>
      <CardContent className="space-y-4">
        {canEdit ? <PolicyForm key={JSON.stringify(data.company)} value={data.company} onSave={(p) => save.mutate({ company: p })} /> : <p className="text-sm text-slate-500">{JSON.stringify(data.company)}</p>}
        {canEdit && (
          <div className="space-y-2 border-t border-slate-100 pt-3">
            <Select value={level} onValueChange={setLevel}>
              <SelectTrigger className="h-9 w-80"><SelectValue placeholder={L('Own rules for one level…', 'قواعد خاصة لمستوى…')} /></SelectTrigger>
              <SelectContent>{levels.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}{data.levels[l.id] ? L(' (own rules)', ' (قواعد خاصة)') : ''}</SelectItem>)}</SelectContent>
            </Select>
            {level && <PolicyForm key={level} value={data.levels[level] ?? data.company} onSave={(p) => save.mutate({ level: { id: level, policy: p } })} onReset={data.levels[level] ? () => save.mutate({ level: { id: level, policy: null } }) : undefined} />}
          </div>
        )}
        <Link href="/dashboard/admin/rubrics" className="text-sm text-indigo-600 underline">{L('Rubric library →', 'مكتبة جداول التصحيح ←')}</Link>
      </CardContent>
    </Card>
  )
}

export default function LmsSettingsPage() {
  useI18n() // re-render on a language switch
  const { data: session } = useSession()
  const role = session?.user?.role
  const { can, ready: permsReady } = useMyPermissions() // effective permissions (Permissions page + overrides)
  const allowed = can('curriculum', 'read')
  const canEdit = can('curriculum', 'approve')
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['lms-settings'], queryFn: () => fetchApi<Data>('/api/lessons/settings'), enabled: allowed })
  const [f, setF] = useState<Settings | null>(null)
  useEffect(() => { if (data) setF(data.settings) }, [data])
  const save = useMutation({
    mutationFn: (body: object) => fetchApi('/api/lessons/settings', { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: () => { notify.success(L('Saved', 'اتحفظ')); qc.invalidateQueries({ queryKey: ['lms-settings'] }) },
    onError: (e: Error) => notify.error(e.message),
  })
  if (!role) return null
  if (role && !permsReady) return null
  if (!allowed) return <AccessDenied title={L('LMS settings', 'إعدادات المنصة')} message={L("You don't have access to the LMS settings.", 'مش عندك صلاحية لإعدادات المنصة.')} />
  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900"><GraduationCap className="h-7 w-7 text-indigo-600" /> {L('LMS settings', 'إعدادات المنصة التعليمية')}</h1>
        <p className="mt-1 text-sm text-slate-500">{L('How lessons open for students and how content is protected. Students see lessons only while the LMS is switched on in Platform.', 'إزاي الدروس بتتفتح للطلبة وإزاي المحتوى محمي. الطلبة بيشوفوا الدروس بس لما المنصة تكون شغالة من Platform.')}</p>
      </div>
      {!data || !f ? <Loader2 className="h-5 w-5 animate-spin text-slate-400" /> : (
        <>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">{L('Company default', 'الافتراضي للشركة')}</CardTitle><CardDescription>{L('Used by every level and group that has no choice of its own.', 'لكل مستوى وجروب مالوش اختيار خاص.')}</CardDescription></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <label className="flex flex-wrap items-center gap-2">{L('How lessons open', 'الدروس بتتفتح إزاي')}
                <Select value={f.unlockMode} onValueChange={(v) => setF({ ...f, unlockMode: v })} disabled={!canEdit}>
                  <SelectTrigger className="h-9 w-80"><SelectValue /></SelectTrigger>
                  <SelectContent>{data.modes.map((m) => <SelectItem key={m} value={m}>{modeLabel(m)}</SelectItem>)}</SelectContent>
                </Select>
              </label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={f.watermark} disabled={!canEdit} onChange={(e) => setF({ ...f, watermark: e.target.checked })} /> {L("Student's name as a watermark on lesson content", 'اسم الطالب كعلامة مائية على المحتوى')}</label>
              <label className="flex items-center gap-2">{L('Kid mode (big, one item per screen, read-aloud) up to age', 'وضع الأطفال (كبير، حاجة في الشاشة، قراءة بالصوت) لحد سن')} <Input type="number" min={0} max={18} className="h-8 w-20" value={f.kidModeMaxAge} disabled={!canEdit} onChange={(e) => setF({ ...f, kidModeMaxAge: Number(e.target.value) || 0 })} /></label>
              <div className="space-y-2 rounded-lg border border-slate-100 p-3">
                <p className="font-semibold text-slate-700">{L('Lessons that wait for the previous one (set on each session)', 'الدروس اللي بتستنى اللي قبلها (بتتحدد من كل حصة)')}</p>
                <label className="flex flex-wrap items-center gap-2">
                  <input type="checkbox" checked={f.gateUngradedOpensAfterDays == null} disabled={!canEdit} onChange={(e) => setF({ ...f, gateUngradedOpensAfterDays: e.target.checked ? null : 2 })} />
                  {L('If the homework must be graded and grading is late, the student waits for the grade', 'لو الواجب لازم يتصحح والتصحيح اتأخر، الطالب يستنى التصحيح')}
                </label>
                {f.gateUngradedOpensAfterDays != null && (
                  <label className="ms-6 flex items-center gap-2">{L('Otherwise the next lesson opens this many days after handing in', 'وإلا الدرس اللي بعده يتفتح بعد التسليم بعدد أيام')} <Input type="number" min={0} max={60} className="h-8 w-20" value={f.gateUngradedOpensAfterDays} disabled={!canEdit} onChange={(e) => setF({ ...f, gateUngradedOpensAfterDays: Math.max(0, Number(e.target.value) || 0) })} /></label>
                )}
                <label className="flex items-center gap-2"><input type="checkbox" checked={f.instructorStudentUnlock !== false} disabled={!canEdit} onChange={(e) => setF({ ...f, instructorStudentUnlock: e.target.checked })} /> {L('The instructor may open a waiting lesson for one student', 'المدرب يقدر يفتح درس مستني لطالب معيّن')}</label>
              </div>
              {canEdit && <Button onClick={() => save.mutate({ settings: f })} disabled={save.isPending}>{save.isPending && <Loader2 className="me-2 h-4 w-4 animate-spin" />}{L('Save', 'حفظ')}</Button>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">{L('Per level', 'لكل مستوى')}</CardTitle><CardDescription>{L('A level can open its lessons differently. A single group can still be changed from its lesson plan (attendance screen).', 'ممكن مستوى يفتح دروسه بطريقة مختلفة. والجروب الواحد يتغيّر من خطة الحصة (شاشة الحضور).')}</CardDescription></CardHeader>
            <CardContent className="space-y-1 text-sm">
              {data.levels.map((l) => (
                <div key={l.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 px-3 py-1.5">
                  <span>{l.name}</span>
                  <Select value={l.mode ?? 'DEFAULT'} onValueChange={(v) => save.mutate({ level: { id: l.id, mode: v === 'DEFAULT' ? null : v } })} disabled={!canEdit}>
                    <SelectTrigger className="h-8 w-72 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="DEFAULT">{L('Company default', 'الافتراضي للشركة')}</SelectItem>
                      {data.modes.map((m) => <SelectItem key={m} value={m}>{modeLabel(m)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </CardContent>
          </Card>
          <HomeworkRules canEdit={canEdit} levels={data.levels} />
          <ToolsCard canEdit={canEdit} />
        </>
      )}
    </div>
  )
}
