'use client'

/** Six phases 2: watch settings — the "watched" percent and the days without watching that alert staff (Super Admin / Admin). */

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { L } from '@/lib/i18n/client'

export function WatchSettingsCard({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['watch-settings'], queryFn: () => fetchApi<{ completePercent: number; inactiveDays: number }>('/api/lessons/watch/settings') })
  if (!data) return null
  const save = async (patch: Record<string, number>) => {
    try { await fetchApi('/api/lessons/watch/settings', { method: 'PUT', body: JSON.stringify(patch) }); notify.success(L('Saved', 'اتحفظ')); void qc.invalidateQueries({ queryKey: ['watch-settings'] }) } catch (e) { notify.error((e as Error).message) }
  }
  const box = 'w-20 rounded-lg border border-slate-300 px-2 py-1'
  return (
    <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 text-sm">
      <h3 className="text-base font-semibold text-slate-900">{L('Watch minutes', 'دقايق المشاهدة')}</h3>
      <label className="flex flex-wrap items-center gap-2">{L('A lesson video counts as watched (done) from', 'فيديو الدرس بيتحسب اتشاف («تم») من')}
        <input type="number" min={10} max={100} disabled={!canEdit} defaultValue={data.completePercent} className={box} onBlur={(e) => { const n = Number(e.target.value); if (n && n !== data.completePercent) void save({ completePercent: n }) }} /> %</label>
      <label className="flex flex-wrap items-center gap-2">{L('Recorded-course students with no watching for', 'طلاب الكورسات المسجلة اللي مابيتفرجوش لمدة')}
        <input type="number" min={1} max={60} disabled={!canEdit} defaultValue={data.inactiveDays} className={box} onBlur={(e) => { const n = Number(e.target.value); if (n && n !== data.inactiveDays) void save({ inactiveDays: n }) }} /> {L('day(s) show in "your work today"', 'يوم بيظهروا في «شغلك النهارده»')}</label>
    </section>
  )
}
