'use client'

/**
 * Phase 6: import from Excel in 3 steps — (1) download the template and choose the filled file, (2) see every row
 * with its problems BEFORE anything is saved, (3) import the good rows in small batches with a progress bar; rows
 * that fail (or had problems) can be downloaded as an Excel file to fix and upload again.
 */

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { L, useI18n } from '@/lib/i18n/client'
import { downloadFrom } from '@/lib/data-exchange/client'
import type { DatasetDef } from '@/lib/data-exchange/registry'
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Loader2, Upload } from 'lucide-react'

interface RowError { field: string | null; en: string; ar: string }
interface ParsedRow { row: number; values: Record<string, unknown>; errors: RowError[] }
interface Preview { fileName: string; rows: ParsedRow[]; valid: number; missingColumns: { key: string; en: string; ar: string }[]; unknownColumns: string[] }
interface Result { row: number; ok: boolean; reason?: string; note?: string }

const BATCH = 5

export function ImportWizard({ d, open, onClose }: { d: DatasetDef; open: boolean; onClose: () => void }) {
  const ar = useI18n().locale === 'ar'
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [onlyBad, setOnlyBad] = useState(true)
  const [results, setResults] = useState<Result[] | null>(null)
  const [progress, setProgress] = useState(0)

  const reset = () => { setPreview(null); setResults(null); setProgress(0) }
  const close = () => { if (!busy) { reset(); onClose() } }

  const upload = async (file: File) => {
    setBusy(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch(`/api/data/${d.key}/import`, { method: 'POST', body: form, credentials: 'same-origin' })
      const j = (await res.json()) as { success: boolean; data?: Preview; error?: { message?: string } }
      if (!j.success || !j.data) throw new Error(j.error?.message || 'Upload failed')
      setPreview(j.data)
      setResults(null)
    } catch (e) {
      notify.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const run = async () => {
    if (!preview) return
    const good = preview.rows.filter((r) => !r.errors.length)
    setBusy(true); setProgress(0)
    const out: Result[] = []
    let logId: string | null = null
    try {
      for (let i = 0; i < good.length; i += BATCH) {
        const chunk = good.slice(i, i + BATCH).map((r) => ({ row: r.row, values: r.values }))
        const r: { results: Result[]; logId: string | null } = await fetchApi('/api/data/' + d.key + '/import/commit', { method: 'POST', body: JSON.stringify({ rows: chunk, fileName: preview.fileName, logId }) })
        out.push(...r.results)
        logId = r.logId
        setProgress(Math.round(((i + chunk.length) / good.length) * 100))
        setResults([...out])
      }
      const okCount = out.filter((x) => x.ok).length
      notify.success(L(`${okCount} rows imported`, `اتضاف ${okCount} سطر`))
      qc.invalidateQueries()
    } catch (e) {
      notify.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const toFix = () => {
    if (!preview) return []
    const failedRows = new Map((results ?? []).filter((r) => !r.ok).map((r) => [r.row, r.reason ?? '']))
    return preview.rows
      .filter((r) => r.errors.length || failedRows.has(r.row))
      .map((r) => ({ row: r.row, values: r.values, reason: r.errors.length ? r.errors.map((e) => (ar ? e.ar : e.en)).join(' • ') : failedRows.get(r.row) ?? '' }))
  }

  const downloadFix = async () => {
    try {
      await downloadFrom(`/api/data/${d.key}/import/failures`, `${d.key}-to-fix.xlsx`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rows: toFix(), lang: ar ? 'ar' : 'en' }),
      })
    } catch (e) { notify.error((e as Error).message) }
  }

  const rows = preview ? (onlyBad ? preview.rows.filter((r) => r.errors.length) : preview.rows) : []
  const bad = preview ? preview.rows.length - preview.valid : 0
  const done = results && results.length === (preview?.valid ?? -1)
  const fixCount = toFix().length

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close() }}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><FileSpreadsheet className="h-5 w-5 text-emerald-600" />{L('Import', 'استيراد')} — {ar ? d.ar : d.en}</DialogTitle></DialogHeader>
        <div className="space-y-4 text-sm">
          <div className="rounded-lg bg-slate-50 p-3 text-slate-600">
            <p>{ar ? d.descAr : d.descEn}</p>
            {(ar ? d.importNoteAr : d.importNoteEn) && <p className="mt-1 text-xs">{ar ? d.importNoteAr : d.importNoteEn}</p>}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-slate-700">{L('1.', '١.')}</span>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => downloadFrom(`/api/data/${d.key}/template?lang=${ar ? 'ar' : 'en'}`, `${d.key}-template.xlsx`).catch((e) => notify.error((e as Error).message))}>
              <Download className="h-4 w-4" />{L('Download the template', 'نزّل القالب')}
            </Button>
            <span className="text-xs text-slate-500">{L('fill it, then:', 'املاه، وبعدين:')}</span>
            <label className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 ${busy ? 'pointer-events-none opacity-60' : ''}`}>
              {busy && !preview ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}{L('Choose the filled file', 'اختار الملف المليان')}
              <input type="file" accept=".xlsx" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) upload(f) }} />
            </label>
          </div>

          {preview && (
            <div className="space-y-3">
              <p className="font-semibold text-slate-700">{L('2. Check', '٢. راجع')} — {preview.fileName}</p>
              {!!preview.missingColumns.length && (
                <p className="flex items-start gap-1.5 rounded-lg bg-rose-50 p-2 text-rose-700"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  {L('Required columns missing:', 'أعمدة مطلوبة ناقصة:')} {preview.missingColumns.map((c) => (ar ? c.ar : c.en)).join('، ')}</p>
              )}
              {!!preview.unknownColumns.length && <p className="text-xs text-slate-500">{L('Ignored columns:', 'أعمدة اتجاهلت:')} {preview.unknownColumns.join('، ')}</p>}
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg border p-2"><p className="text-xl font-bold">{preview.rows.length}</p><p className="text-xs text-slate-500">{L('rows', 'سطر')}</p></div>
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-2"><p className="text-xl font-bold text-emerald-700">{preview.valid}</p><p className="text-xs text-slate-500">{L('ready', 'جاهز')}</p></div>
                <div className="rounded-lg border border-rose-200 bg-rose-50 p-2"><p className="text-xl font-bold text-rose-700">{bad}</p><p className="text-xs text-slate-500">{L('with problems', 'فيه مشاكل')}</p></div>
              </div>
              <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={onlyBad} onChange={(e) => setOnlyBad(e.target.checked)} />{L('Show only rows with problems', 'اعرض السطور اللي فيها مشاكل بس')}</label>
              <div className="max-h-64 overflow-y-auto rounded-lg border">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-slate-50 text-slate-500"><tr><th className="p-2 text-start">{L('Row', 'السطر')}</th><th className="p-2 text-start">{L('Problems', 'المشاكل')}</th></tr></thead>
                  <tbody>
                    {rows.slice(0, 300).map((r) => {
                      const res = results?.find((x) => x.row === r.row)
                      return (
                        <tr key={r.row} className="border-t">
                          <td className="p-2 align-top">{r.row}</td>
                          <td className="p-2">
                            {r.errors.length ? r.errors.map((e, i) => <p key={i} className="text-rose-700">{ar ? e.ar : e.en}</p>)
                              : res ? (res.ok ? <p className="text-emerald-700">✓ {res.note}</p> : <p className="text-rose-700">{res.reason}</p>)
                              : <p className="text-emerald-700">{L('Ready', 'جاهز')}</p>}
                          </td>
                        </tr>
                      )
                    })}
                    {!rows.length && <tr><td colSpan={2} className="p-3 text-center text-emerald-700">{L('No problems.', 'مفيش مشاكل.')}</td></tr>}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 p-3">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-slate-700">{L('3.', '٣.')}</span>
                  {busy && <span className="flex items-center gap-1.5 text-slate-600"><Loader2 className="h-4 w-4 animate-spin" />{progress}%</span>}
                  {done && <span className="flex items-center gap-1 text-emerald-700"><CheckCircle2 className="h-4 w-4" />{L('Done', 'خلص')}: {results!.filter((x) => x.ok).length} ✓ · {results!.filter((x) => !x.ok).length} ✗</span>}
                </div>
                <div className="flex gap-2">
                  {fixCount > 0 && <Button size="sm" variant="outline" className="gap-1.5" onClick={downloadFix}><Download className="h-4 w-4" />{L(`Rows to fix (${fixCount})`, `السطور اللي محتاجة تتصلح (${fixCount})`)}</Button>}
                  {!done && <Button size="sm" className="gap-1.5" disabled={busy || !preview.valid || !!preview.missingColumns.length} onClick={run}>
                    <Upload className="h-4 w-4" />{L(`Import ${preview.valid} ready rows`, `استورد ${preview.valid} سطر جاهز`)}</Button>}
                </div>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
