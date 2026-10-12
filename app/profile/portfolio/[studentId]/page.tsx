'use client'

/** P2: printable portfolio (A4) for a school / university — projects, skills, certificates, quotes, experience. */

import { use } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { I18nProvider, L, LanguageSwitch, useI18n } from '@/lib/i18n/client'
import { Button } from '@/components/ui/button'
import { Printer } from 'lucide-react'

type Media = { url: string; type: 'image' | 'video' } | null
interface Data {
  age: number
  student: { name: string; photo: string | null; campus: string; joinedAt: string }
  skills: { course: string; scores: { id: string; nameEn: string; nameAr: string; percent: number | null }[] }[]
  projects: { id: string; titleEn: string; titleAr: string; status: string; media: Media; description?: string | null }[]
  quotes: { text: string }[]
  experience: { id: string; role: string; titleEn: string | null; from: string; to: string | null }[]
  certificates: { title: string; certificateNumber: string; issuedDate: string }[]
  stampCount: number
}
const day = (d: string, ar: boolean) => new Date(d).toLocaleDateString(ar ? 'ar-EG' : 'en-GB', { month: 'short', year: 'numeric' })
const ROLE: Record<string, [string, string]> = { ASSISTANT: ['Assistant instructor', 'مساعد مدرب'], AMBASSADOR: ['Ambassador', 'سفير'], ALUMNI: ['Alumni', 'خريج'], OTHER: ['Experience', 'خبرة'] }

function Portfolio({ studentId }: { studentId: string }) {
  const { locale, dir } = useI18n()
  const ar = locale === 'ar'
  const { data: d, error } = useQuery({ queryKey: ['portfolio', studentId], queryFn: () => fetchApi<Data>(`/api/profile/${studentId}?view=portfolio`), retry: false })
  if (error) return <p className="p-6 text-sm text-red-600">{(error as Error).message}</p>
  if (!d) return <p className="p-6 text-sm text-gray-500">{L('Loading…', 'جاري التحميل…')}</p>
  const projects = d.projects.filter((p) => p.status === 'APPROVED')
  return (
    <div className="keep-light min-h-screen bg-gray-100 py-6 print:bg-white print:py-0" dir={dir}>
      <style>{'@media print { @page { size: A4; margin: 12mm; } body { background: #fff; } }'}</style>
      <div className="mx-auto mb-4 flex max-w-3xl justify-center gap-2 print:hidden"><Button onClick={() => window.print()}><Printer className="me-2 h-4 w-4" /> {L('Print / save as PDF', 'طباعة / حفظ PDF')}</Button><LanguageSwitch /></div>
      <div className="mx-auto max-w-3xl space-y-5 bg-white p-8 text-sm text-black shadow print:shadow-none">
        <div className="flex items-center gap-4 border-b-2 border-black pb-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {d.student.photo && <img src={d.student.photo} alt="" className="h-24 w-20 rounded object-cover" />}
          <div className="flex-1"><p className="text-2xl font-bold">{d.student.name}</p><p className="text-gray-600">{L('Portfolio', 'ملف الإنجازات')} · TechNova · {d.student.campus}</p><p className="text-xs text-gray-500">{L('With TechNova since', 'مع TechNova من')} {day(d.student.joinedAt, ar)} · {d.stampCount} {L('passport stamps', 'ختم في الجواز')}</p></div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/bglogo.png" alt="TechNova" className="h-12 w-auto" />
        </div>
        {projects.length > 0 && (
          <section><h2 className="mb-2 border-b border-gray-400 font-bold">{L('Projects', 'المشاريع')}</h2>
            <div className="grid grid-cols-3 gap-3">{projects.slice(0, 9).map((p) => (
              <div key={p.id} className="space-y-1 text-xs">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {p.media?.type === 'image' && <img src={p.media.url} alt="" className="h-28 w-full rounded object-cover" />}
                <p className="font-semibold">{ar ? p.titleAr : p.titleEn}</p>{p.description && <p className="text-gray-600">{p.description}</p>}
              </div>
            ))}</div>
          </section>
        )}
        {d.skills.length > 0 && (
          <section><h2 className="mb-2 border-b border-gray-400 font-bold">{L('Skills', 'المهارات')}</h2>
            <div className="grid grid-cols-2 gap-4">{d.skills.map((s) => (
              <div key={s.course} className="space-y-1 text-xs"><p className="font-semibold">{s.course}</p>
                {s.scores.filter((k) => k.percent != null).map((k) => <div key={k.id} className="flex items-center gap-2"><span className="w-28">{(ar && k.nameAr) || k.nameEn}</span><div className="h-2 flex-1 rounded bg-gray-200"><div className="h-2 rounded bg-gray-800" style={{ width: `${k.percent}%` }} /></div><span className="w-10 text-end">{k.percent}%</span></div>)}
              </div>
            ))}</div>
          </section>
        )}
        {d.certificates.length > 0 && <section><h2 className="mb-2 border-b border-gray-400 font-bold">{L('Certificates', 'الشهادات')}</h2>{d.certificates.map((c) => <p key={c.certificateNumber}>{c.title} · <span className="font-mono">{c.certificateNumber}</span> · {day(c.issuedDate, ar)}</p>)}</section>}
        {d.experience.length > 0 && <section><h2 className="mb-2 border-b border-gray-400 font-bold">{L('Experience', 'الخبرة')}</h2>{d.experience.map((e) => <p key={e.id}><b>{ar ? ROLE[e.role]?.[1] : ROLE[e.role]?.[0]}</b>{e.titleEn ? ` · ${e.titleEn}` : ''} · {day(e.from, ar)}{e.to ? ` → ${day(e.to, ar)}` : ''}</p>)}</section>}
        {d.quotes.length > 0 && <section><h2 className="mb-2 border-b border-gray-400 font-bold">{L('What the instructors say', 'المدربين بيقولوا')}</h2>{d.quotes.slice(0, 4).map((q, i) => <p key={i} className="italic">“{q.text}”</p>)}</section>}
        <p className="text-[10px] text-gray-500">{L('Certificates can be checked with their number at', 'الشهادات تتأكد برقمها من')} {typeof window !== 'undefined' ? window.location.origin : ''}/verify</p>
      </div>
    </div>
  )
}

export default function PortfolioPage({ params }: { params: Promise<{ studentId: string }> }) {
  const { studentId } = use(params)
  return <I18nProvider><Portfolio studentId={studentId} /></I18nProvider>
}
