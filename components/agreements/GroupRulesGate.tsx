'use client'

/**
 * Rules & policies: blocks the portal of a parent until they accept the rules of each child's group (new group, or the
 * rules changed). One child + group per step; scroll to the end, tick, accept. The general agreements come first.
 */

import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { useI18n } from '@/lib/i18n/client'
import { Button } from '@/components/ui/button'
import { ListChecks, Loader2 } from 'lucide-react'

interface Pending { groupId: string; studentId: string; student: string; group: string; place: string; level: string; updated: boolean; items: { source: string; en: string; ar: string }[]; hash: string }

export function GroupRulesGate() {
  const { pick, dir } = useI18n()
  const qc = useQueryClient()
  const { data: agreementsLeft } = useQuery({ queryKey: ['agreements-pending'], queryFn: () => fetchApi<{ blocking: boolean }[]>('/api/agreements/pending'), staleTime: 60_000 })
  const { data } = useQuery({ queryKey: ['group-rules-pending'], queryFn: () => fetchApi<Pending[]>('/api/guardian-portal/group-rules'), staleTime: 60_000 })
  const [read, setRead] = useState(false)
  const [ticked, setTicked] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const current = data?.[0]

  useEffect(() => {
    setRead(false)
    setTicked(false)
    const el = box.current
    if (el) { el.scrollTop = 0; if (el.scrollHeight <= el.clientHeight + 8) setRead(true) }
  }, [current?.groupId, current?.studentId])

  const accept = useMutation({
    mutationFn: (p: Pending) => fetchApi('/api/guardian-portal/group-rules', { method: 'POST', body: JSON.stringify({ groupId: p.groupId, studentId: p.studentId, hash: p.hash }) }),
    onSuccess: () => { notify.success(pick('Thank you — accepted', 'شكرًا — اتسجلت موافقتك')); qc.invalidateQueries({ queryKey: ['group-rules-pending'] }) },
    onError: (e: Error) => { notify.error(e.message); qc.invalidateQueries({ queryKey: ['group-rules-pending'] }) },
  })

  // the general agreements are accepted first (AgreementsGate)
  if (!current || (agreementsLeft ?? []).some((a) => a.blocking)) return null
  return (
    <div className="fixed inset-0 z-[94] flex items-center justify-center bg-slate-900/60 p-3 print:hidden" dir={dir} role="dialog" aria-modal="true">
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="border-b border-slate-100 p-5">
          <p className="flex items-center gap-2 text-lg font-bold text-slate-900"><ListChecks className="h-5 w-5 text-indigo-600" />{pick('Group rules', 'قواعد الجروب')}</p>
          <p className="text-sm text-slate-600">{current.student} · {current.group}{current.level ? ` · ${current.level}` : ''}{current.place ? ` · ${current.place}` : ''}</p>
          {current.updated && <p className="text-xs text-amber-700">{pick('The rules were updated — please read them again.', 'القواعد اتغيرت — من فضلك اقراها تاني.')}</p>}
          {(data?.length ?? 0) > 1 && <p className="mt-1 text-xs font-semibold text-indigo-700">{pick(`${data!.length} groups to accept`, `${data!.length} جروب محتاجين موافقة`)}</p>}
        </div>
        <div
          ref={box}
          onScroll={(e) => { const el = e.currentTarget; if (el.scrollTop + el.clientHeight >= el.scrollHeight - 8) setRead(true) }}
          className="m-5 flex-1 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm leading-relaxed text-slate-700"
        >
          <ol className="list-decimal space-y-1.5 ps-5">{current.items.map((x, i) => <li key={i}>{pick(x.en, x.ar)}</li>)}</ol>
        </div>
        <div className="space-y-3 border-t border-slate-100 p-5">
          {!read && <p className="text-xs text-slate-500">{pick('Scroll to the end to continue.', 'انزل لآخر القواعد عشان تكمّل.')}</p>}
          <label className={`flex items-center gap-2 text-sm font-medium ${read ? 'text-slate-800' : 'text-slate-400'}`}>
            <input type="checkbox" className="h-4 w-4" disabled={!read} checked={ticked} onChange={(e) => setTicked(e.target.checked)} />
            {pick('I have read the group rules and I accept them', 'قريت قواعد الجروب وموافق عليها')}
          </label>
          <Button className="w-full" disabled={!ticked || accept.isPending} onClick={() => accept.mutate(current)}>
            {accept.isPending && <Loader2 className="me-2 h-4 w-4 animate-spin" />}{pick('Accept', 'موافق')}
          </Button>
        </div>
      </div>
    </div>
  )
}
