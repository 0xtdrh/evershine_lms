'use client'

/**
 * a02 (2026-10-31): which curriculum of its level a group reads — automatic (by its place / way), the main one, or
 * another one. Shown only when the level has more than one curriculum. Changes only before the first session.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { L, useI18n } from '@/lib/i18n/client'
import { BookOpen } from 'lucide-react'

interface Data { chosen: string | null; reads: { id: string; name: string } | null; version: number | null; canChange: boolean; options: { id: string; name: string }[] }

export function GroupCurriculumPicker({ groupId, canEdit }: { groupId: string; canEdit: boolean }) {
  useI18n()
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['group-curriculum', groupId], queryFn: () => fetchApi<Data>(`/api/groups/${groupId}/curriculum`) })
  const save = useMutation({
    mutationFn: (v: string | null) => fetchApi(`/api/groups/${groupId}`, { method: 'PATCH', body: JSON.stringify({ curriculumVariantId: v }) }),
    onSuccess: () => { notify.success(L('Saved', 'اتحفظ')); qc.invalidateQueries({ queryKey: ['group-curriculum', groupId] }); qc.invalidateQueries({ queryKey: ['group-lessons'] }) },
    onError: (e: Error) => notify.error(e.message),
  })
  if (!data || data.options.length === 0) return null
  const readsName = data.reads?.name || L('Main curriculum', 'المنهج الأساسي')
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2 text-sm">
      <BookOpen className="h-4 w-4 text-indigo-600" />
      <span className="font-semibold text-slate-800">{L('Curriculum', 'المنهج')}</span>
      <select aria-label={L('Curriculum of this group', 'منهج الجروب')} className="h-8 rounded-md border px-2 text-sm" disabled={!canEdit || !data.canChange || save.isPending}
        value={data.chosen ?? ''} onChange={(e) => save.mutate(e.target.value || null)}>
        <option value="">{L('Automatic (by place / way)', 'تلقائي (حسب المكان / الطريقة)')}</option>
        <option value="MAIN">{L('Main curriculum', 'المنهج الأساسي')}</option>
        {data.options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
      <span className="text-xs text-slate-500">
        {L('Reads:', 'بيقرا:')} <b>{readsName}</b>{data.version ? ` · ${L('version', 'نسخة')} ${data.version}` : ''}
        {!data.canChange && ` · ${L('the group has started, it keeps its curriculum', 'الجروب بدأ، بيفضل على منهجه')}`}
      </span>
    </div>
  )
}
