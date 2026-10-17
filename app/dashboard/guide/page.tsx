'use client'

/**
 * User guide — the steps of the signed-in person's role (admins see every role, to train others), with search and a
 * link to each screen. Content: lib/guide/content.ts (Arabic, with English technical words). Printable.
 */

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { L, useI18n } from '@/lib/i18n/client'
import { sectionsFor } from '@/lib/guide/content'
import { matchesSearch } from '@/lib/navigation/sections'
import { BookOpenCheck, ExternalLink, Printer } from 'lucide-react'

export default function GuidePage() {
  const { locale } = useI18n()
  const ar = locale === 'ar'
  const role = useSession().data?.user?.role ?? ''
  const all = useMemo(() => sectionsFor(role), [role])
  const [open, setOpen] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const sections = all
    .map((s) => ({ ...s, steps: q ? s.steps.filter((st) => matchesSearch(q, st.title, st.body)) : s.steps }))
    .filter((s) => s.steps.length)
  const current = open ?? (q ? null : all[0]?.key ?? null)

  return (
    <div className="space-y-5" dir="rtl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900"><BookOpenCheck className="h-7 w-7 text-indigo-600" /> {L('User guide', 'دليل الاستخدام')}</h1>
          <p className="mt-1 text-sm text-slate-500">{L('What to do in TechNova, step by step, for your role. The guide is written in Arabic.', 'تعمل إيه في TechNova خطوة بخطوة حسب دورك. دوس على أي خطوة تروح للشاشة بتاعتها.')}</p>
        </div>
        <Button size="sm" variant="outline" className="print:hidden" onClick={() => window.print()}><Printer className="me-1 h-4 w-4" /> {L('Print', 'طباعة')}</Button>
      </div>
      <Input className="max-w-md print:hidden" placeholder={L('Search the guide…', 'دوّر في الدليل…')} value={q} onChange={(e) => setQ(e.target.value)} />
      {all.length > 1 && !q && (
        <div className="flex flex-wrap gap-2 print:hidden">
          {all.map((s) => (
            <button key={s.key} type="button" onClick={() => setOpen(s.key)} className={`rounded-full border px-3 py-1 text-sm ${current === s.key ? 'border-indigo-400 bg-indigo-50 font-semibold text-indigo-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>
              {ar ? s.ar : s.en}
            </button>
          ))}
        </div>
      )}
      {!sections.length && <p className="text-sm text-slate-500">{L('Nothing found.', 'مفيش نتايج.')}</p>}
      {sections.filter((s) => q || s.key === current).map((s) => (
        <Card key={s.key}>
          <CardContent className="space-y-3 pt-4">
            <div>
              <h2 className="text-lg font-bold text-slate-900">{s.ar}</h2>
              {s.who && <p className="text-xs text-slate-500" dir="ltr">{s.en} · {s.who}</p>}
            </div>
            <ol className="space-y-3">
              {s.steps.map((st, i) => (
                <li key={st.title} className="flex gap-3">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-700">{i + 1}</span>
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-800">
                      {st.title}
                      {st.href && <Link href={st.href} className="ms-2 inline-flex items-center gap-1 text-xs font-normal text-indigo-600 hover:underline print:hidden">{L('Open', 'افتح')} <ExternalLink className="h-3 w-3" /></Link>}
                    </p>
                    <p className="text-sm leading-relaxed text-slate-600">{st.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
