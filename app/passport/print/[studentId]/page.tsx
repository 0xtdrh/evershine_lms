'use client'

/**
 * P1: printable passport (branch staff only, outside the dashboard). ?kind=BOOKLET (A6 booklet) | PASSPORT_PDF (A4) |
 * TRANSCRIPT (A4, company stamp + signature). Pressing Print logs the print first (copy number on the page).
 */

import { use, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import QRCode from 'qrcode'
import { fetchApi } from '@/lib/api-client'
import { I18nProvider, L, LanguageSwitch, useI18n } from '@/lib/i18n/client'
import { StampBadge } from '@/components/passport/StampBadge'
import { Button } from '@/components/ui/button'
import { Printer } from 'lucide-react'

interface Data {
  passport: { number: string }
  student: { name: string; nameAr: string | null; reg: string; photo: string | null; joinedAt: string; campus: string; cardCode: string | null }
  cover: string
  stamps: { id: string; nameEn: string; nameAr: string; icon: string; shape: string; color: string; label: string | null; awardedAt: string }[]
  certificates: { title: string; number: string | null; issuedAt: string }[]
  transcript: { course: string; level: string; finalScore: number | null; passed: boolean | null; date: string }[]
  companyStamp: string | null; signature: string | null; signatureName: string
}

const day = (d: string, ar: boolean) => new Date(d).toLocaleDateString(ar ? 'ar-EG' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
const chunk = <T,>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n))

function PrintView({ studentId }: { studentId: string }) {
  const kind = (useSearchParams().get('kind') ?? 'PASSPORT_PDF') as 'BOOKLET' | 'PASSPORT_PDF' | 'TRANSCRIPT'
  const { locale, dir } = useI18n()
  const ar = locale === 'ar'
  const { data: d, error } = useQuery({ queryKey: ['passport-print', studentId], queryFn: () => fetchApi<Data>(`/api/passport/${studentId}/print`), retry: false })
  const [qr, setQr] = useState('')
  const [copy, setCopy] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (d?.student.cardCode) QRCode.toDataURL(d.student.cardCode, { margin: 0, width: 200 }).then(setQr).catch(() => undefined) }, [d?.student.cardCode])
  const print = async () => {
    setBusy(true)
    try {
      const r = await fetchApi<{ copyNo: number }>(`/api/passport/${studentId}/prints`, { method: 'POST', body: JSON.stringify({ kind }) })
      setCopy(r.copyNo)
      setTimeout(() => window.print(), 300)
    } catch (e) { alert((e as Error).message) } finally { setBusy(false) }
  }
  if (error) return <p className="p-6 text-sm text-red-600">{(error as Error).message}</p>
  if (!d) return <p className="p-6 text-sm text-gray-500">{L('Loading…', 'جاري التحميل…')}</p>
  const copyLine = copy ? `${L('Copy', 'نسخة')} ${copy}${copy > 1 ? ` — ${L('replacement', 'بدل فاقد')}` : ''}` : ''
  const page = kind === 'BOOKLET' ? 'A6' : 'A4'
  const identity = (
    <div className="flex items-start gap-3">
      {d.student.photo
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={d.student.photo} alt="" className={`${kind === 'BOOKLET' ? 'h-24 w-20' : 'h-32 w-28'} rounded border border-black object-cover`} />
        : <div className={`${kind === 'BOOKLET' ? 'h-24 w-20' : 'h-32 w-28'} flex items-center justify-center rounded border border-black text-3xl`}>👤</div>}
      <div className="min-w-0 flex-1 space-y-0.5 text-[11px]">
        <p className="text-base font-bold">{d.student.name}</p>
        {d.student.nameAr && <p dir="rtl" className="text-sm">{d.student.nameAr}</p>}
        <p>{L('Passport no.', 'رقم الجواز')}: <b className="font-mono">{d.passport.number}</b></p>
        <p>{L('Registration', 'رقم القيد')}: {d.student.reg}</p>
        <p>{L('Branch', 'الفرع')}: {d.student.campus}</p>
        <p>{L('Joined', 'تاريخ الانضمام')}: {day(d.student.joinedAt, ar)}</p>
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {qr && <img src={qr} alt="QR" className={kind === 'BOOKLET' ? 'h-16 w-16' : 'h-20 w-20'} />}
    </div>
  )
  const stampsGrid = (list: Data['stamps'], size: number) => (
    <div className="flex flex-wrap justify-center gap-2">{list.map((s) => <StampBadge key={s.id} stamp={{ ...s, date: s.awardedAt }} ar={ar} size={size} />)}</div>
  )
  return (
    <div className="keep-light min-h-screen bg-gray-100 py-6 print:bg-white print:py-0" dir={dir}>
      <style>{`@media print { @page { size: ${page}; margin: ${kind === 'BOOKLET' ? '6mm' : '12mm'}; } body { background: #fff; } .pg { box-shadow: none !important; margin: 0 !important; break-after: page; } }`}</style>
      <div className="mx-auto mb-4 flex max-w-3xl flex-wrap items-center justify-center gap-2 px-4 print:hidden">
        <Button onClick={print} disabled={busy}><Printer className="me-2 h-4 w-4" /> {L('Print (counted)', 'اطبع (بتتسجل)')}</Button>
        <LanguageSwitch />
        {copyLine && <span className="text-sm text-gray-600">{copyLine}</span>}
      </div>

      {kind === 'BOOKLET' && (
        <>
          <div className="pg mx-auto mb-4 flex h-[148mm] w-[105mm] flex-col items-center justify-center gap-3 p-4 text-center text-white shadow" style={{ background: d.cover }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/bglogo.png" alt="TechNova" className="h-14 w-auto rounded bg-white/90 p-1" />
            <p className="text-lg font-bold tracking-[0.3em]">{L('PASSPORT', 'جواز سفر')}</p>
            <p className="font-mono text-sm">{d.passport.number}</p>
            {copyLine && <p className="text-[10px]">{copyLine}</p>}
          </div>
          <div className="pg mx-auto mb-4 h-[148mm] w-[105mm] bg-white p-4 text-black shadow">{identity}<p className="mt-4 text-center text-[10px] text-gray-500">TechNova · STEM · Robotics · Programming</p></div>
          {chunk(d.stamps, 6).map((list, i) => (
            <div key={i} className="pg mx-auto mb-4 h-[148mm] w-[105mm] bg-white p-3 text-black shadow">
              <p className="mb-2 text-center text-[10px] uppercase tracking-widest text-gray-500">{L('Stamps', 'الأختام')} · {i + 1}</p>
              {stampsGrid(list, 110)}
            </div>
          ))}
          <div className="pg mx-auto mb-4 h-[148mm] w-[105mm] bg-white p-3 text-black shadow">
            <p className="mb-2 text-center text-[10px] uppercase tracking-widest text-gray-500">{L('Stamps from events', 'أختام الفعاليات')}</p>
            <div className="grid h-[120mm] grid-cols-2 gap-2">{Array.from({ length: 6 }, (_, i) => <div key={i} className="rounded border border-dashed border-gray-300" />)}</div>
          </div>
        </>
      )}

      {kind === 'PASSPORT_PDF' && (
        <div className="pg mx-auto max-w-3xl space-y-4 bg-white p-6 text-black shadow">
          <div className="flex items-center justify-between border-b-2 border-black pb-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/bglogo.png" alt="TechNova" className="h-10 w-auto" />
            <div className="text-end"><p className="font-bold">{L('TECHNOVA PASSPORT', 'جواز سفر TechNova')}</p>{copyLine && <p className="text-xs">{copyLine}</p>}</div>
          </div>
          {identity}
          <h3 className="border-b border-gray-400 font-bold">{L('Stamps', 'الأختام')}</h3>
          {d.stamps.length ? stampsGrid(d.stamps, 120) : <p className="text-sm text-gray-500">—</p>}
          <h3 className="border-b border-gray-400 font-bold">{L('Certificates', 'الشهادات')}</h3>
          {d.certificates.map((c, i) => <p key={i} className="text-sm">{c.title} · <span className="font-mono">{c.number}</span> · {day(c.issuedAt, ar)}</p>)}
        </div>
      )}

      {kind === 'TRANSCRIPT' && (
        <div className="pg mx-auto max-w-3xl space-y-4 bg-white p-6 text-sm text-black shadow">
          <div className="flex items-center justify-between border-b-2 border-black pb-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/bglogo.png" alt="TechNova" className="h-10 w-auto" />
            <div className="text-end"><p className="font-bold">{L('OFFICIAL TRANSCRIPT', 'كشف درجات رسمي')}</p><p className="text-xs">{day(new Date().toISOString(), ar)}{copyLine ? ` · ${copyLine}` : ''}</p></div>
          </div>
          {identity}
          <table className="w-full border-collapse text-xs">
            <thead><tr className="border-b border-black text-start"><th className="py-1 text-start">{L('Course', 'الكورس')}</th><th className="text-start">{L('Level', 'المستوى')}</th><th className="text-start">{L('Final', 'النهائي')}</th><th className="text-start">{L('Result', 'النتيجة')}</th><th className="text-start">{L('Date', 'التاريخ')}</th></tr></thead>
            <tbody>{d.transcript.map((t, i) => <tr key={i} className="border-b border-gray-200"><td className="py-1">{t.course}</td><td>{t.level}</td><td>{t.finalScore == null ? '—' : Math.round(t.finalScore)}</td><td>{t.passed ? L('Passed', 'ناجح') : L('Not passed', 'لم ينجح')}</td><td>{day(t.date, ar)}</td></tr>)}</tbody>
          </table>
          <h3 className="border-b border-gray-400 font-bold">{L('Certificates', 'الشهادات')}</h3>
          {d.certificates.length ? d.certificates.map((c, i) => <p key={i}>{c.title} · <span className="font-mono">{c.number}</span> · {day(c.issuedAt, ar)}</p>) : <p className="text-gray-500">—</p>}
          <div className="flex items-end justify-between pt-8">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {d.companyStamp ? <img src={d.companyStamp} alt="stamp" className="h-28 w-28 object-contain opacity-90" /> : <div className="h-28 w-28" />}
            <div className="text-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {d.signature && <img src={d.signature} alt="signature" className="mx-auto h-16 object-contain" />}
              <p className="border-t border-black pt-1 text-xs">{d.signatureName || L('Signature', 'الإمضاء')}</p>
            </div>
          </div>
          <p className="text-[10px] text-gray-500">{L('Certificates can be checked at', 'الشهادات تتأكد من')} {typeof window !== 'undefined' ? window.location.origin : ''}/verify</p>
        </div>
      )}
    </div>
  )
}

export default function PassportPrintPage({ params }: { params: Promise<{ studentId: string }> }) {
  const { studentId } = use(params)
  return <I18nProvider><PrintView studentId={studentId} /></I18nProvider>
}
