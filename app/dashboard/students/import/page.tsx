'use client'

import { useState, useRef } from 'react'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import { fetchApi } from '@/lib/api-client'
import {
  downloadStudentImportTemplate,
  downloadStudentImportFailuresExcel,
  parseStudentImportFile,
} from '@/lib/excel'
import { studentBulkImportSchema } from '@/lib/validation/student'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { ArrowLeft, Upload, Download, FileSpreadsheet, Loader2, CheckCircle, XCircle } from 'lucide-react'
import { AccessDenied } from '@/components/AccessDenied'
import { notify } from '@/lib/notify'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { L, useI18n } from '@/lib/i18n/client'

interface ImportResult {
  results: Array<{
    row: number
    success: boolean
    registrationNumber?: string
    error?: string
  }>
  created: number
  failed: number
}

export default function StudentImportPage() {
  useI18n() // re-render on a language switch
  const { data: session, status } = useSession()
  const role = session?.user?.role
  const fileRef = useRef<HTMLInputElement>(null)
  const [previewCount, setPreviewCount] = useState(0)
  const [parsedRows, setParsedRows] = useState<Record<string, string | number>[]>([])
  const [importing, setImporting] = useState(false)
  const [outcome, setOutcome] = useState<ImportResult | null>(null)

  if (status === 'loading') return null
  if (role !== 'SUPER_ADMIN' && role !== 'ADMIN') {
    return (
      <AccessDenied
        title={L('Bulk Import Restricted', 'الاستيراد مقفول')}
        message="Only administrators can bulk-import student records."
      />
    )
  }

  const handleFile = async (file: File) => {
    const buffer = await file.arrayBuffer()
    const rows = parseStudentImportFile(buffer)
    setParsedRows(rows)
    setPreviewCount(rows.length)
    setOutcome(null)
    if (rows.length === 0) notify.error(L('No valid rows found — check headers match the template', 'مفيش سطور صحيحة — اتأكد إن العناوين زي النموذج'))
    else notify.success(`Parsed ${rows.length} student row(s)`)
  }

  const runImport = async () => {
    const validated = studentBulkImportSchema.safeParse({ rows: parsedRows })
    if (!validated.success) {
      notify.error(L('Validation failed', 'في أخطاء'), {
        description: validated.error.errors[0]?.message ?? 'Check required columns',
      })
      return
    }
    setImporting(true)
    try {
      const res = await fetchApi<ImportResult>('/api/students/import', {
        method: 'POST',
        body: JSON.stringify(validated.data),
      })
      const data = (res as { data?: ImportResult }).data ?? res
      setOutcome(data)
      notify.success(`Created ${data.created}, failed ${data.failed}`)
    } catch (err: unknown) {
      notify.error(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/dashboard/students">
          <Button variant="outline" size="icon">
            <ArrowLeft className="w-4 h-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{L('Bulk Student Import', 'استيراد طلاب')}</h1>
          <p className="text-sm text-gray-500">
            {L('Upload Excel (.xlsx) using the official template. Max 500 students per run.', 'ارفع ملف Excel (.xlsx) بالنموذج الرسمي. أقصى 500 طالب في المرة.')}
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-green-600" />
            {L('Step 1 — Download template', 'الخطوة 1 — نزّل النموذج')}
          </CardTitle>
          <CardDescription>
            {L('Use exact column headers. The campus code must match your branch (Campuses page).', 'استخدم نفس عناوين الأعمدة. كود الفرع لازم يطابق فرعك (صفحة الفروع).')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" className="gap-2" onClick={() => downloadStudentImportTemplate()}>
            <Download className="w-4 h-4" />
            {L('Download .xlsx template', 'نزّل نموذج .xlsx')}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Upload className="w-5 h-5 text-blue-600" />
            {L('Step 2 — Upload filled file', 'الخطوة 2 — ارفع الملف المليان')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) handleFile(f)
            }}
          />
          <Button variant="outline" className="gap-2" onClick={() => fileRef.current?.click()}>
            <Upload className="w-4 h-4" />
            {L('Choose file', 'اختار الملف')}
          </Button>
          {previewCount > 0 && (
            <p className="text-sm text-gray-600">
              {L('Ready to import', 'جاهز للاستيراد')} <strong>{previewCount}</strong> {L('student(s).', 'طالب.')}
            </p>
          )}
          <Button
            disabled={parsedRows.length === 0 || importing}
            className="gap-2"
            onClick={runImport}
          >
            {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
            {importing ? 'Importing…' : 'Run import'}
          </Button>
        </CardContent>
      </Card>

      {outcome && outcome.failed > 0 && (
        <Button
          variant="outline"
          className="gap-2"
          onClick={() => {
            const failedRows = outcome.results
              .filter((r) => !r.success)
              .map((r) => ({
                ...parsedRows[r.row - 1],
                importError: r.error ?? 'Unknown error',
                importRow: r.row,
              }))
            downloadStudentImportFailuresExcel(failedRows)
            notify.success(L('Failed rows exported — fix and re-import', 'السطور اللي فشلت اتصدّرت — صلّحها واستورد تاني'))
          }}
        >
          <Download className="w-4 h-4" />
          {L('Download failed rows (.xlsx)', 'نزّل السطور اللي فشلت (.xlsx)')}
        </Button>
      )}

      {outcome && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{L('Import results', 'نتيجة الاستيراد')}</CardTitle>
            <CardDescription>
              {outcome.created} {L('created ·', 'اتعمل ·')} {outcome.failed} {L('failed', 'فشل')}
            </CardDescription>
          </CardHeader>
          <CardContent className="max-h-80 overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{L('Row', 'السطر')}</TableHead>
                  <TableHead>{L('Status', 'الحالة')}</TableHead>
                  <TableHead>{L('Detail', 'التفاصيل')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {outcome.results.map((r) => (
                  <TableRow key={r.row}>
                    <TableCell>{r.row}</TableCell>
                    <TableCell>
                      {r.success ? (
                        <CheckCircle className="w-4 h-4 text-green-600" />
                      ) : (
                        <XCircle className="w-4 h-4 text-red-600" />
                      )}
                    </TableCell>
                    <TableCell className="text-xs font-mono">
                      {r.success ? r.registrationNumber : r.error}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
