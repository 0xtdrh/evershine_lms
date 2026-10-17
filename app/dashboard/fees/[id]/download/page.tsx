'use client'

import { use, useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { fetchApi } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Loader2, ArrowLeft, Download, Eye } from 'lucide-react'
import { AcademyLogo } from '@/components/AcademyLogo'
import { formatCurrency } from '@/lib/utils'
import { FeeDownloadPreview, type FeeInvoicePreview } from '@/components/fees/FeeDownloadPreview'
import { L, useI18n } from '@/lib/i18n/client'

interface FeeDownloadPageProps {
  params: Promise<{ id: string }>
}

export default function FeeDownloadPage({ params }: FeeDownloadPageProps) {
  useI18n() // re-render on a language switch
  const { id } = use(params)
  const router = useRouter()
  const [downloading, setDownloading] = useState<'student' | 'teacher' | null>(null)

  const { data: invoice, isLoading, error } = useQuery<FeeInvoicePreview>({
    queryKey: ['fee-invoice-download', id],
    queryFn: () => fetchApi<FeeInvoicePreview>(`/api/fees/${id}`),
    staleTime: 30_000,
  })

  const downloadReceipt = async (variant: 'student' | 'teacher') => {
    const elementId = variant === 'student' ? 'student-download-preview' : 'teacher-download-preview'
    const element = document.getElementById(elementId)
    if (!element) return

    setDownloading(variant)
    try {
      const { downloadPdf } = await import('@/lib/pdf')
      await downloadPdf({
        element,
        filename: `FeeReceipt_${invoice?.challanNumber}_${variant}`,
        orientation: 'portrait',
        format: 'a4',
        scale: 2,
      })
    } catch (err) {
      console.error(err)
    } finally {
      setDownloading(null)
    }
  }

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-slate-700" />
      </div>
    )
  }

  if (error || !invoice) {
    return (
      <div className="max-w-2xl mx-auto py-16 text-center space-y-4">
        <p className="text-lg font-semibold text-slate-900">{L('Unable to load fee receipt preview.', 'معاينة الإيصال ماحمّلتش.')}</p>
        <p className="text-sm text-slate-500">{L('Please return to the invoice details page or try again later.', 'ارجع لصفحة الفاتورة أو جرّب بعدين.')}</p>
        <div className="flex justify-center">
          <Link href={`/dashboard/fees/${id}`}>
            <Button variant="outline">{L('Back to Invoice', 'رجوع للفاتورة')}</Button>
          </Link>
        </div>
      </div>
    )
  }

  const studentFullName = `${invoice.student.firstName} ${invoice.student.lastName}`
  const totalAmount = Number(invoice.totalAmount)
  const paidAmount = Number(invoice.paidAmount)
  const balance = totalAmount - paidAmount

  return (
    <div className="space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <div className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-start gap-4">
            <AcademyLogo className="w-16 h-16" />
            <div>
              <p className="text-xs uppercase tracking-[0.32em] text-slate-500">TechNova</p>
              <h1 className="text-3xl font-bold tracking-tight text-slate-950">{L('Styled Fee Receipt Downloads', 'تنزيل الإيصال')}</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                {L('View and export the student or teacher fee receipt in a professional A4 print format using clear boxes, borders, and accessible typography.', 'شوف ونزّل الإيصال بشكل A4.')}
              </p>
            </div>
          </div>
          <div className="rounded-full border border-slate-300 bg-slate-100 px-4 py-2 text-xs font-semibold uppercase tracking-[0.26em] text-slate-700 shadow-sm">
            {L('Printable format', 'للطباعة')}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
          <Link href={`/dashboard/fees/${id}`} className="inline-flex">
            <Button variant="outline" size="sm" className="gap-2">
              <ArrowLeft className="h-4 w-4" /> {L('Back', 'رجوع')}
            </Button>
          </Link>
          <Button variant="secondary" size="sm" className="gap-2" onClick={() => router.refresh()}>
            <Eye className="h-4 w-4" /> {L('Refresh', 'تحديث')}
          </Button>
      </div>

      <Card className="border-slate-200 bg-slate-50">
        <CardContent className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
          <div className="space-y-3">
            <p className="text-sm font-semibold text-slate-700">{L('Invoice summary', 'ملخص الفاتورة')}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-3xl bg-white p-4 border border-slate-200">
                <p className="text-xs uppercase tracking-[0.32em] text-slate-500">{L('Student', 'الطالب')}</p>
                <p className="mt-2 font-semibold text-slate-900">{studentFullName}</p>
              </div>
              <div className="rounded-3xl bg-white p-4 border border-slate-200">
                <p className="text-xs uppercase tracking-[0.32em] text-slate-500">{L('Invoice', 'الفاتورة')}</p>
                <p className="mt-2 font-semibold text-slate-900">{invoice.challanNumber}</p>
              </div>
              <div className="rounded-3xl bg-white p-4 border border-slate-200">
                <p className="text-xs uppercase tracking-[0.32em] text-slate-500">{L('Due Balance', 'المتبقي')}</p>
                <p className="mt-2 text-xl font-black text-rose-700">{formatCurrency(balance)}</p>
              </div>
              <div className="rounded-3xl bg-white p-4 border border-slate-200">
                <p className="text-xs uppercase tracking-[0.32em] text-slate-500">{L('Status', 'الحالة')}</p>
                <p className="mt-2 font-semibold text-slate-900">{invoice.status}</p>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <p className="text-sm font-semibold text-slate-700">{L('Download outputs', 'التنزيل')}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Button
                className="gap-2"
                onClick={() => downloadReceipt('student')}
                disabled={downloading === 'student'}
              >
                {downloading === 'student' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} {L('Student PDF', 'PDF الطالب')}
              </Button>
              <Button
                className="gap-2"
                onClick={() => downloadReceipt('teacher')}
                disabled={downloading === 'teacher'}
              >
                {downloading === 'teacher' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} {L('Teacher PDF', 'PDF المدرب')}
              </Button>
            </div>
            <p className="text-sm text-slate-500">{L('Each preview is optimized for the target user type and can be exported as a single-page PDF with clean spacing and a modern layout.', 'كل نسخة متظبطة لصاحبها وبتتنزّل صفحة واحدة PDF.')}</p>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3 rounded-3xl border border-slate-200 bg-white px-4 py-4">
            <div>
              <p className="text-sm font-semibold text-slate-900">{L('Student Download', 'نسخة الطالب')}</p>
              <p className="text-sm text-slate-500">{L('A polished fee receipt for students and guardians.', 'إيصال للطلاب وأولياء الأمور.')}</p>
            </div>
            <Button size="sm" variant="outline" onClick={() => downloadReceipt('student')} disabled={downloading === 'student'}>
              {L('Download Student PDF', 'نزّل PDF الطالب')}
            </Button>
          </div>
          <FeeDownloadPreview invoice={invoice} variant="student" elementId="student-download-preview" />
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3 rounded-3xl border border-slate-200 bg-white px-4 py-4">
            <div>
              <p className="text-sm font-semibold text-slate-900">{L('Teacher Download', 'نسخة المدرب')}</p>
              <p className="text-sm text-slate-500">{L('A teacher-facing copy with audit notes and finance review details.', 'نسخة فيها ملاحظات المراجعة.')}</p>
            </div>
            <Button size="sm" variant="outline" onClick={() => downloadReceipt('teacher')} disabled={downloading === 'teacher'}>
              {L('Download Teacher PDF', 'نزّل PDF المدرب')}
            </Button>
          </div>
          <FeeDownloadPreview invoice={invoice} variant="teacher" elementId="teacher-download-preview" />
        </div>
      </div>

      <style jsx global>{`
        @media print {
          body { background: white !important; }
          .no-print { display: none !important; }
          #student-download-preview, #teacher-download-preview { page-break-after: always; }
        }
      `}</style>
    </div>
  )
}
