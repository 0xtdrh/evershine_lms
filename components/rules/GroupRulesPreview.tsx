'use client'

/** Rules & policies: the rules of the chosen group, shown on the admission form (the parent accepts them in the portal). */

import { useQuery } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { L } from '@/lib/i18n/client'
import { ListChecks } from 'lucide-react'

export function GroupRulesPreview({ groupId }: { groupId: string }) {
  const { data } = useQuery({ queryKey: ['group-rules', groupId], queryFn: () => fetchApi<{ items: { en: string; ar: string }[] }>(`/api/groups/${groupId}/rules`), enabled: !!groupId })
  if (!data) return null
  return (
    <div className="mt-2 rounded-lg border border-indigo-100 bg-indigo-50/50 p-3 text-xs">
      <p className="mb-1 flex items-center gap-1 font-semibold text-indigo-800"><ListChecks className="h-3.5 w-3.5" />{L('Rules of this group', 'قواعد الجروب ده')}</p>
      <ol className="list-decimal space-y-0.5 ps-5 text-slate-700">{data.items.map((x, i) => <li key={i}>{L(x.en, x.ar)}</li>)}</ol>
      <p className="mt-2 text-slate-500">
        {L('Tell the parent: they accept these rules in the portal. ', 'بلّغ ولي الأمر: هيوافق على القواعد دي من البوابة. ')}
        <a className="text-indigo-700 hover:underline" href={`/reports/group-rules/${groupId}`} target="_blank" rel="noopener">{L('Print to sign', 'اطبعها للإمضاء')}</a>
      </p>
    </div>
  )
}
