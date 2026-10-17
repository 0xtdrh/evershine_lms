'use client'

/**
 * Phase 6: printable table (→ "Save as PDF") for any exportable dataset, with the TechNova logo and colours.
 * Outside the dashboard so it prints clean; Arabic right-to-left. Same rows as the Excel export (only the person's
 * places; filters from the link). The browser prints Arabic correctly, which a PDF library would not.
 */

import { use } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { codeLabel, datasetByKey, exportFields } from '@/lib/data-exchange/registry'
import { Loader2, Printer } from 'lucide-react'

export default function DataPrintPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = use(params)
  const d = datasetByKey(key)
  const qs = typeof window !== 'undefined' ? window.location.search.replace(/^\?/, '') : ''
  const sp = new URLSearchParams(qs)
  const ar = sp.get('lang') !== 'en'
  const { data, error, isLoading } = useQuery({
    queryKey: ['data-print', key, qs],
    queryFn: () => fetchApi<{ rows: Record<string, unknown>[]; count: number }>(`/api/data/${key}/export?format=json&for=pdf&${qs}`),
    enabled: !!d,
  })
  if (!d) return <p className="p-6 text-center text-sm">Not found</p>
  const fields = exportFields(d)
  const cell = (k: string, v: unknown) => {
    const f = fields.find((x) => x.key === k)
    if (v === null || v === undefined || v === '') return ''
    if (f?.type === 'bool') return v ? (ar ? 'نعم' : 'Yes') : (ar ? 'لا' : 'No')
    if (f?.type === 'enum') { const o = f.options?.find((x) => x.value === v); return o ? (ar ? o.ar : o.en) : String(v) }
    return String(codeLabel(v, ar))
  }
  const filters = [sp.get('from') && `${ar ? 'من' : 'from'} ${sp.get('from')}`, sp.get('to') && `${ar ? 'لحد' : 'to'} ${sp.get('to')}`, sp.get('status')].filter(Boolean).join(' · ')
  return (
    <div className="keep-light min-h-screen bg-gray-100 py-6 print:bg-white print:py-0" dir={ar ? 'rtl' : 'ltr'}>
      <style>{'@media print { @page { size: A4 landscape; margin: 10mm; } body { background: #fff; } thead { display: table-header-group; } tr { break-inside: avoid; } }'}</style>
      <div className="mx-auto mb-4 flex max-w-6xl justify-center px-4 print:hidden">
        <Button onClick={() => window.print()} disabled={!data}><Printer className="me-2 h-4 w-4" />{ar ? 'اطبع / احفظ PDF' : 'Print / save as PDF'}</Button>
      </div>
      {isLoading && <p className="flex items-center justify-center gap-2 text-sm text-gray-600"><Loader2 className="h-4 w-4 animate-spin" />{ar ? 'بيحمّل…' : 'Loading…'}</p>}
      {error && <p className="text-center text-sm text-red-600">{(error as Error).message}</p>}
      {data && (
        <div className="mx-auto max-w-6xl bg-white p-6 text-black shadow print:max-w-none print:p-0 print:shadow-none" data-document-page>
          <div className="mb-4 flex items-center justify-between border-b-4 pb-3" style={{ borderColor: '#1B4F8A' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/bglogo.png" alt="TechNova" className="h-10 w-auto" />
            <div className="text-end">
              <h1 className="text-lg font-bold" style={{ color: '#1B4F8A' }}>{ar ? d.ar : d.en} ({data.count})</h1>
              <p className="text-xs text-gray-600">{filters ? `${filters} · ` : ''}{new Date().toLocaleString(ar ? 'ar-EG' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</p>
            </div>
          </div>
          <table className="w-full border-collapse text-[10px]">
            <thead>
              <tr>{fields.map((f) => <th key={f.key} className="border border-gray-300 p-1 text-start font-semibold text-white" style={{ background: '#1B4F8A' }}>{ar ? f.ar : f.en}</th>)}</tr>
            </thead>
            <tbody>
              {data.rows.map((r, i) => (
                <tr key={i} className={i % 2 ? 'bg-gray-50' : ''}>
                  {fields.map((f) => <td key={f.key} className="border border-gray-200 p-1 align-top">{cell(f.key, r[f.key])}</td>)}
                </tr>
              ))}
              {!data.rows.length && <tr><td colSpan={fields.length} className="p-4 text-center text-gray-500">{ar ? 'مفيش بيانات' : 'No rows'}</td></tr>}
            </tbody>
          </table>
          <p className="mt-3 text-[9px] text-gray-500">TechNova · {ar ? 'اتطبع من السيستم' : 'Printed from the system'}</p>
        </div>
      )}
    </div>
  )
}
