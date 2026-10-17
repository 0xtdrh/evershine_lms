'use client'

/**
 * Phase 6: the Excel / PDF / Import buttons of one table — on its screen and in the Import & Export centre.
 * Shown only when the person has the right (4-level permissions: data_export / data_import + the table's own).
 * `filters` (branch, dates, group, status) are passed to the export as they are.
 */

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { Button } from '@/components/ui/button'
import { L, useI18n } from '@/lib/i18n/client'
import { datasetByKey, type DatasetKey } from '@/lib/data-exchange/registry'
import { downloadFrom, filterQuery } from '@/lib/data-exchange/client'
import { ImportWizard } from './ImportWizard'
import { FileDown, FileSpreadsheet, Loader2, Printer, Upload } from 'lucide-react'

export function useDataRights() {
  return useQuery({ queryKey: ['data-rights'], queryFn: () => fetchApi<{ key: DatasetKey; export: boolean; import: boolean }[]>('/api/data'), staleTime: 5 * 60_000, retry: false })
}

export function DataExchangeButtons({ dataset, filters = {}, size = 'sm' }: { dataset: DatasetKey; filters?: Record<string, string | null | undefined>; size?: 'sm' | 'xs' }) {
  const ar = useI18n().locale === 'ar'
  const { data } = useDataRights()
  const [busy, setBusy] = useState(false)
  const [importing, setImporting] = useState(false)
  const d = datasetByKey(dataset)
  const rights = data?.find((x) => x.key === dataset)
  if (!d || !rights || (!rights.export && !rights.import)) return null
  const q = filterQuery({ ...filters, lang: ar ? 'ar' : 'en' })
  const cls = size === 'xs' ? 'h-7 gap-1 px-2 text-xs' : 'h-8 gap-1.5'
  const excel = async () => {
    setBusy(true)
    try { await downloadFrom(`/api/data/${dataset}/export?format=xlsx&${q}`, `${dataset}.xlsx`) } catch (e) { notify.error((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {rights.export && (
        <>
          <Button size="sm" variant="outline" className={cls} onClick={excel} disabled={busy} title={L('Export to Excel', 'تصدير Excel')}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4 text-emerald-600" />}Excel
          </Button>
          <Button size="sm" variant="outline" className={cls} onClick={() => window.open(`/reports/data/${dataset}?${q}`, '_blank', 'noopener')} title={L('Print / save as PDF', 'طباعة / حفظ PDF')}>
            <Printer className="h-4 w-4 text-rose-600" />PDF
          </Button>
        </>
      )}
      {rights.import && (
        <>
          <Button size="sm" variant="outline" className={cls} onClick={() => setImporting(true)}><Upload className="h-4 w-4 text-indigo-600" />{L('Import', 'استيراد')}</Button>
          <ImportWizard d={d} open={importing} onClose={() => setImporting(false)} />
        </>
      )}
      {!rights.export && !rights.import && <FileDown className="hidden" />}
    </span>
  )
}
