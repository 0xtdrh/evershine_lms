'use client'

/**
 * Blocks the dashboard / portal until the signed-in user accepts every mandatory agreement (current version).
 * One agreement per step; the user must scroll to the end before "I accept" is enabled. Agreements inside a grace
 * period show as a reminder banner instead of blocking.
 */

import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { useI18n } from '@/lib/i18n/client'
import { Button } from '@/components/ui/button'
import { ShieldCheck, Loader2 } from 'lucide-react'

interface Pending { id: string; key: string; version: number; titleEn: string; titleAr: string; bodyEn: string; bodyAr: string; updated: boolean; blocking: boolean }

export function AgreementsGate() {
  const { t, pick, dir } = useI18n()
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['agreements-pending'], queryFn: () => fetchApi<Pending[]>('/api/agreements/pending'), staleTime: 60_000 })
  const blocking = (data ?? []).filter((a) => a.blocking)
  const grace = (data ?? []).filter((a) => !a.blocking)
  const [step, setStep] = useState(0)
  const [read, setRead] = useState(false)
  const [ticked, setTicked] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const current = blocking[Math.min(step, blocking.length - 1)]

  useEffect(() => {
    setRead(false)
    setTicked(false)
    const el = box.current
    if (el) { el.scrollTop = 0; if (el.scrollHeight <= el.clientHeight + 8) setRead(true) }
  }, [current?.id])

  const accept = useMutation({
    mutationFn: (a: Pending) => fetchApi('/api/agreements/pending', { method: 'POST', body: JSON.stringify({ agreementId: a.id, version: a.version }) }),
    onSuccess: () => {
      if (step + 1 < blocking.length) setStep(step + 1)
      else { notify.success(t('agree.done')); setStep(0); qc.invalidateQueries({ queryKey: ['agreements-pending'] }) }
    },
    onError: (e: Error) => notify.error(e.message || t('common.error')),
  })

  if (!data?.length) return null
  if (!blocking.length) {
    return (
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm print:hidden" dir={dir}>
        <span className="text-amber-800">{grace.map((g) => pick(g.titleEn, g.titleAr)).join(' · ')} — {t('agree.updated', { v: grace[0].version })}</span>
        <Button size="sm" variant="outline" onClick={() => qc.setQueryData(['agreements-pending'], (data ?? []).map((a) => ({ ...a, blocking: true })))}>{t('agree.accept')}</Button>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-slate-900/60 p-3 print:hidden" dir={dir} role="dialog" aria-modal="true">
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="border-b border-slate-100 p-5">
          <p className="flex items-center gap-2 text-lg font-bold text-slate-900"><ShieldCheck className="h-5 w-5 text-indigo-600" /> {t('agree.title')}</p>
          <p className="text-sm text-slate-500">{t('agree.subtitle')}</p>
          <p className="mt-1 text-xs font-semibold text-indigo-700">{t('agree.step', { n: Math.min(step, blocking.length - 1) + 1, total: blocking.length })}</p>
        </div>
        <div className="px-5 pt-4">
          <h2 className="text-base font-bold text-slate-800">{pick(current.titleEn, current.titleAr)}</h2>
          {current.updated && <p className="text-xs text-amber-700">{t('agree.updated', { v: current.version })}</p>}
        </div>
        <div
          ref={box}
          onScroll={(e) => { const el = e.currentTarget; if (el.scrollTop + el.clientHeight >= el.scrollHeight - 8) setRead(true) }}
          className="m-5 mt-3 flex-1 overflow-y-auto whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm leading-relaxed text-slate-700"
        >
          {pick(current.bodyEn, current.bodyAr)}
        </div>
        <div className="space-y-3 border-t border-slate-100 p-5">
          {!read && <p className="text-xs text-slate-500">{t('agree.mustScroll')}</p>}
          <label className={`flex items-center gap-2 text-sm font-medium ${read ? 'text-slate-800' : 'text-slate-400'}`}>
            <input type="checkbox" className="h-4 w-4" disabled={!read} checked={ticked} onChange={(e) => setTicked(e.target.checked)} />
            {t('agree.accept')}
          </label>
          <Button className="w-full" disabled={!ticked || accept.isPending} onClick={() => accept.mutate(current)}>
            {accept.isPending && <Loader2 className="me-2 h-4 w-4 animate-spin" />}{step + 1 < blocking.length ? t('common.next') : t('agree.acceptAll')}
          </Button>
        </div>
      </div>
    </div>
  )
}
