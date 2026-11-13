'use client'

/** Six phases 1-D: printable booking summary (TechNova logo): who, course, level, way, group times, invoice, status, what comes next. */

import { use } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { I18nProvider, LanguageSwitch, useI18n } from '@/lib/i18n/client'
import { Printer } from 'lucide-react'

type Summary = {
  id: string; status: string; statusText: { en: string; ar: string }; mode: string; code: string | null; course: { en: string; ar: string }; level: string | null; who: string; registrationNumber: string | null
  family: { firstName: string; lastName: string; phoneNumber: string } | null; group: { name: string; campus: string; slots: unknown } | null
  invoice: { number: string; total: number; paid: number; status: string } | null; holdUntil: string | null; createdAt: string; confirmedAt: string | null
}
const DAYS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const DAYS_AR = ['الأحد', 'الاتنين', 'التلات', 'الأربع', 'الخميس', 'الجمعة', 'السبت']

function View({ id }: { id: string }) {
  const { pick, dir, locale } = useI18n()
  const { data, error } = useQuery({ queryKey: ['booking-summary', id], queryFn: () => fetchApi<Summary>(`/api/bookings/${id}/summary`) })
  const fmt = (d: string | null) => (d ? new Date(d).toLocaleString(locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', { timeZone: 'Africa/Cairo', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—')
  const slots = (x: unknown) => (Array.isArray(x) ? (x as { dayOfWeek: number; time: string }[]).map((s) => `${pick(DAYS_EN[s.dayOfWeek], DAYS_AR[s.dayOfWeek])} ${s.time}`).join(' · ') : '')
  const way = (m: string) => (m === 'ONLINE' ? pick('Live online', 'لايف أونلاين') : m === 'RECORDED' ? pick('Recorded', 'مسجل') : pick('At a branch', 'في الفرع'))
  const Row = ({ k, v }: { k: string; v: React.ReactNode }) => <tr className="border-b"><th className="w-40 py-2 text-start font-semibold">{k}</th><td className="py-2">{v}</td></tr>
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
            <h1 className="text-lg font-bold" style={{ color: '#1B4F8A' }}>{pick('Booking summary', 'ملخص الحجز')}</h1>
          </div>
          <table className="w-full">
            <tbody>
              <Row k={pick('Student', 'الطالب')} v={<>{data.who}{data.registrationNumber ? <span dir="ltr"> · {data.registrationNumber}</span> : null}</>} />
              {data.family ? <Row k={pick('Family', 'ولي الأمر')} v={<>{data.family.firstName} {data.family.lastName} · <span dir="ltr">{data.family.phoneNumber}</span></>} /> : null}
              <Row k={pick('Course', 'الكورس')} v={pick(data.course.en, data.course.ar)} />
              {data.level ? <Row k={pick('Level', 'المستوى')} v={data.level} /> : null}
              <Row k={pick('Way', 'الطريقة')} v={way(data.mode)} />
              {data.group ? <Row k={pick('Group', 'الجروب')} v={<>{data.group.name} · {data.group.campus}{slots(data.group.slots) ? <div>{slots(data.group.slots)} ({pick('Cairo time', 'بتوقيت القاهرة')})</div> : null}</>} /> : null}
              {data.invoice ? <Row k={pick('First invoice', 'أول فاتورة')} v={<><span dir="ltr">{data.invoice.number}</span> · {data.invoice.total} {pick('EGP', 'ج.م')} · {pick('paid', 'مدفوع')} {data.invoice.paid}</>} /> : null}
              {data.code ? <Row k={pick('Code', 'الكود')} v={<span dir="ltr">{data.code}</span>} /> : null}
              <Row k={pick('Status', 'الحالة')} v={<b>{pick(data.statusText.en, data.statusText.ar)}</b>} />
              <Row k={pick('Booked on', 'تاريخ الحجز')} v={fmt(data.createdAt)} />
              {data.status === 'HOLD' ? <Row k={pick('Pay before', 'ادفع قبل')} v={fmt(data.holdUntil)} /> : null}
            </tbody>
          </table>
          <div className="mt-6 rounded-lg bg-gray-50 p-4 leading-relaxed">
            <p className="mb-1 font-semibold">{pick('What comes next', 'اللي جاي')}</p>
            <p>{data.status === 'HOLD' ? pick('Pay the first invoice before the time above (online, wallet or a transfer receipt); the seat is then confirmed.', 'ادفع أول فاتورة قبل الميعاد اللي فوق (أونلاين أو المحفظة أو صورة تحويل) والمكان يتأكد.')
              : data.status === 'CONFIRMED' ? pick('The seat is confirmed. The student signs in to the portal to see the sessions and lessons.', 'المكان اتأكد. الطالب بيدخل البوابة يشوف الحصص والدروس.')
              : data.status === 'PLACEMENT' ? pick('TechNova will contact you to know the level and choose the right group.', 'TechNova هتتواصل معاك تعرف المستوى وتختار الجروب المناسب.')
              : data.status === 'WAITING' ? pick('You are on the waiting list; we will tell you when a seat is free.', 'انت في قايمة الانتظار؛ هنبلغك أول ما يفضى مكان.')
              : pick('Contact TechNova for any question.', 'كلّم TechNova لأي سؤال.')}</p>
            <p className="mt-2 text-xs">{pick('Rules and policies', 'القواعد والسياسات')}: <span dir="ltr">{typeof window !== 'undefined' ? `${window.location.origin}/policies` : '/policies'}</span></p>
          </div>
        </div>
      )}
    </div>
  )
}

export default function BookingSummaryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  return <I18nProvider><View id={id} /></I18nProvider>
}
