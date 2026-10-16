'use client'

/** Rules & policies: printable group rules (TechNova logo), with a signature line; ?student=<id> puts the child's name. */

import { use } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { I18nProvider, LanguageSwitch, useI18n } from '@/lib/i18n/client'
import { Printer } from 'lucide-react'

interface Status { items: { source: string; en: string; ar: string }[]; families: { studentId: string; student: string; parent: string | null }[] }

function View({ groupId }: { groupId: string }) {
  const { pick, dir } = useI18n()
  const studentId = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('student') : null
  const { data, error } = useQuery({ queryKey: ['group-rules', groupId], queryFn: () => fetchApi<Status>(`/api/groups/${groupId}/rules`) })
  const fam = data?.families.find((f) => f.studentId === studentId)
  return (
    <div className="keep-light min-h-screen bg-gray-100 py-6 print:bg-white print:py-0" dir={dir}>
      <style>{'@media print { @page { size: A4; margin: 14mm; } body { background: #fff; } }'}</style>
      <div className="mx-auto mb-4 flex max-w-3xl justify-center gap-2 px-4 print:hidden">
        <Button onClick={() => window.print()}><Printer className="me-2 h-4 w-4" />{pick('Print / save as PDF', 'اطبع / احفظ PDF')}</Button>
        <LanguageSwitch />
      </div>
      {error && <p className="text-center text-sm text-red-600">{(error as Error).message}</p>}
      {data && (
        <div className="mx-auto max-w-3xl bg-white p-8 text-sm text-black shadow print:shadow-none" data-document-page>
          <div className="mb-5 flex items-center justify-between border-b-4 pb-3" style={{ borderColor: '#1B4F8A' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/bglogo.png" alt="TechNova" className="h-10 w-auto" />
            <h1 className="text-lg font-bold" style={{ color: '#1B4F8A' }}>{pick('Group rules', 'قواعد الجروب')}</h1>
          </div>
          {fam && <p className="mb-3">{pick('Student', 'الطالب')}: <b>{fam.student}</b>{fam.parent ? ` — ${pick('Parent', 'ولي الأمر')}: ${fam.parent}` : ''}</p>}
          <ol className="list-decimal space-y-2 ps-6 leading-relaxed">{data.items.map((x, i) => <li key={i}>{pick(x.en, x.ar)}</li>)}</ol>
          <div className="mt-12 grid grid-cols-2 gap-8 text-xs">
            <div className="border-t pt-2">{pick('Parent / guardian signature', 'توقيع ولي الأمر')}</div>
            <div className="border-t pt-2">{pick('Date', 'التاريخ')}</div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function GroupRulesPrintPage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = use(params)
  return <I18nProvider><View groupId={groupId} /></I18nProvider>
}
