'use client'

/**
 * The new "real passport" (owner 28/11/2026, map S49): cover that opens like a book, the data page (guilloche paper,
 * photo, fields the owner switched on, seal + signature, machine-readable lines), «My trips» and a visa page per track.
 * Used by the dashboard passport, the share link and (paper look) the print pages. Always light: it is paper.
 */

import { L } from '@/lib/i18n/client'
import { editionNumber, mrzLines, sealSvg } from '@/lib/passport/book'

export interface Look { titleEn: string; titleAr: string; sealMode: 'DRAWN' | 'IMAGE' | 'NONE'; sealTop: string; sealBottom: string; sealImage: string | null; signature: string | null; signatureName: string }
export interface BookFields {
  age: number | null; placeEn: string; placeAr: string; school: string | null; firstSession: string | null
  hours: number | null; projects: number | null; certificates: number | null; tracks: string[] | null
  showJoined: boolean; showReg: boolean; showPhoto: boolean
}
export interface Trip { id: string; course: string; level: string; track: string | null; color: string; status: 'DONE' | 'FLYING'; from: string; to: string | null }
export interface Visa { trackId: string; name: string; color: string; since: string; graduated: boolean }

export const NAVY = '#0B3A5B'
export const TEAL = '#1E7FA0'
export const CYAN = '#3CC4DA'

const day = (d: string | null | undefined, ar: boolean) => (d ? new Date(d).toLocaleDateString(ar ? 'ar-EG-u-nu-latn' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Cairo' }) : '—')

/** The guilloche paper of the inside pages (fine teal rings, like a security print). */
export const PAPER: React.CSSProperties = {
  backgroundColor: '#f5fbfd',
  backgroundImage: `repeating-radial-gradient(circle at 10% 0%, rgba(30,127,160,0.07) 0 1px, transparent 1px 9px), repeating-radial-gradient(circle at 90% 100%, rgba(60,196,218,0.08) 0 1px, transparent 1px 11px)`,
}

/** The drawn seal or the owner's own stamp image; nothing when the owner chose «signature only». */
export function Seal({ look, size = 96, color = TEAL }: { look: Look; size?: number; color?: string }) {
  if (look.sealMode === 'NONE') return null
  if (look.sealMode === 'IMAGE' && look.sealImage) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={look.sealImage} alt="" style={{ width: size, height: size }} className="rotate-[-8deg] object-contain opacity-85 mix-blend-multiply" />
  }
  const svg = sealSvg({ top: look.sealTop, bottom: look.sealBottom, color }).replace('width="200" height="200"', 'width="100%" height="100%"')
  // eslint-disable-next-line react/no-danger
  return <div aria-hidden style={{ width: size, height: size }} className="rotate-[-8deg] opacity-80" dangerouslySetInnerHTML={{ __html: svg }} />
}

/** Seal + signature block ("issued by"). */
export function IssuedBy({ look, ar, small = false }: { look: Look; ar: boolean; small?: boolean }) {
  return (
    <div className="flex items-end gap-2">
      <Seal look={look} size={small ? 64 : 84} />
      {(look.signature || look.signatureName) && (
        <div className="text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {look.signature && <img src={look.signature} alt="" className={`${small ? 'h-8' : 'h-10'} mx-auto object-contain mix-blend-multiply`} />}
          <p className="border-t border-slate-400 px-2 pt-0.5 text-[9px] text-slate-600">{look.signatureName || (ar ? 'التوقيع' : 'Signature')}</p>
        </div>
      )}
    </div>
  )
}

/** The closed passport. `onOpen` = tap to open it (the page plays the opening). */
export function PassportCover({ look, ar, number, edition, young, color, onOpen, opening = false, className = 'max-w-[320px]' }: { look: Look; ar: boolean; number: string; edition: number; young: boolean; color?: string; onOpen?: () => void; opening?: boolean; className?: string }) {
  const top = young ? (color || TEAL) : NAVY
  return (
    <button type="button" onClick={onOpen} aria-label={L('Open the passport', 'افتح الجواز')}
      className={`keep-light relative mx-auto flex aspect-[5/7] w-full ${className} flex-col items-center justify-between overflow-hidden rounded-[18px] p-6 text-center text-white shadow-xl transition-transform duration-700 [transform-origin:left_center] rtl:[transform-origin:right_center] ${opening ? '[transform:perspective(1200px)_rotateY(-100deg)] rtl:[transform:perspective(1200px)_rotateY(100deg)] opacity-0' : 'hover:-translate-y-0.5'}`}
      style={{ background: `linear-gradient(160deg, ${top} 0%, #072538 100%)`, transitionProperty: 'transform, opacity' }}>
      {/* stitched edge + spine */}
      <span aria-hidden className="pointer-events-none absolute inset-2 rounded-[14px] border border-dashed border-white/25" />
      <span aria-hidden className="pointer-events-none absolute inset-y-0 start-0 w-3 bg-black/20" />
      <div className="relative space-y-1">
        {/* letter spacing only for Latin: it breaks the joined Arabic letters */}
        <p className={`text-[13px] font-semibold text-[#3CC4DA] ${ar ? '' : 'uppercase tracking-[0.3em]'}`}>{ar ? look.titleAr : look.titleEn}</p>
        {young && <p className="text-lg">✨🚀✨</p>}
      </div>
      <div className="relative">
        <Seal look={{ ...look, sealMode: look.sealMode === 'IMAGE' ? 'DRAWN' : look.sealMode === 'NONE' ? 'DRAWN' : look.sealMode }} size={young ? 150 : 132} color={CYAN} />
      </div>
      <div className="relative space-y-1">
        <p className={`text-xl font-bold ${ar ? '' : 'tracking-[0.25em]'}`}>{ar ? 'جواز سفر' : 'PASSPORT'}</p>
        <p className={`text-[10px] text-white/70 ${ar ? 'uppercase tracking-[0.4em]' : ''}`}>{ar ? 'PASSPORT' : 'جواز سفر'}</p>
        <p className="pt-1 font-mono text-xs text-white/80" dir="ltr">{editionNumber(number, edition)}</p>
        {onOpen && <p className="pt-2 text-[11px] text-[#3CC4DA]">{L('Tap to open', 'دوس علشان تفتحه')} 👆</p>}
      </div>
    </button>
  )
}

function Field({ en, ar, value, wide = false, mono = false }: { en: string; ar: string; value: React.ReactNode; wide?: boolean; mono?: boolean }) {
  if (value == null || value === '' || value === false) return null
  return (
    <div className={wide ? 'col-span-2' : ''}>
      <p className="text-[9px] uppercase tracking-wider text-[#1E7FA0]">{ar} / {en}</p>
      <p className={`text-sm font-semibold text-slate-900 ${mono ? 'font-mono' : ''}`}>{value}</p>
    </div>
  )
}

/** The data (bio) page. */
export function DataPage({ look, ar, name, nameAr, number, edition, reg, joinedAt, photo, qr, book }: {
  look: Look; ar: boolean; name: string; nameAr: string | null; number: string; edition: number; reg: string | null; joinedAt: string | null
  photo: string | null; qr?: string; book: BookFields | null
}) {
  const [l1, l2] = mrzLines(name, number, joinedAt)
  const b = book
  return (
    <div className="keep-light overflow-hidden rounded-2xl border border-[#1E7FA0]/30 text-slate-900 shadow-lg" style={PAPER}>
      <div className="flex items-center justify-between px-4 py-2 text-white" style={{ background: `linear-gradient(90deg, ${NAVY}, ${TEAL})` }}>
        <p className={`text-xs font-bold ${ar ? '' : 'tracking-widest'}`}>{ar ? look.titleAr : look.titleEn}</p>
        <p className="font-mono text-[11px]" dir="ltr">{editionNumber(number, edition)}</p>
      </div>
      <div className="flex gap-3 p-4">
        <div className="flex shrink-0 flex-col items-center gap-2">
          {b?.showPhoto !== false && (photo
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={photo} alt="" className="h-28 w-[5.5rem] rounded-md border-2 border-white object-cover shadow" />
            : <div className="flex h-28 w-[5.5rem] items-center justify-center rounded-md border-2 border-dashed border-[#1E7FA0]/40 bg-white/60 text-4xl">🧑‍🚀</div>)}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {qr && <img src={qr} alt="QR" className="h-16 w-16 rounded bg-white p-1" />}
        </div>
        <div className="grid min-w-0 flex-1 grid-cols-2 content-start gap-x-3 gap-y-2">
          <Field en="Name" ar="الاسم" value={<span className="block truncate">{ar && nameAr ? nameAr : name}</span>} wide />
          {nameAr && !ar && <Field en="Arabic name" ar="بالعربي" value={<span dir="rtl">{nameAr}</span>} wide />}
          <Field en="Age" ar="السن" value={b?.age != null ? (ar ? `${b.age} سنة` : `${b.age} years`) : null} />
          <Field en="Place" ar="المكان" value={ar ? b?.placeAr : b?.placeEn} />
          <Field en="School" ar="المدرسة" value={b?.school} wide />
          <Field en="Joined" ar="الانضمام" value={b?.showJoined !== false && joinedAt ? day(joinedAt, ar) : null} />
          <Field en="First session" ar="أول حصة" value={b?.firstSession ? day(b.firstSession, ar) : null} />
          <Field en="Reg. no." ar="رقم القيد" value={b?.showReg !== false ? reg : null} mono />
        </div>
      </div>
      <div className="flex items-end justify-between gap-2 px-4 pb-2">
        <p className="text-[10px] text-slate-500">{L('Issued by TechNova', 'صادر من TechNova')}</p>
        <IssuedBy look={look} ar={ar} small />
      </div>
      <div className="border-t border-[#1E7FA0]/20 bg-white/70 px-3 py-1.5 font-mono text-[10px] leading-4 tracking-[0.18em] text-slate-700" dir="ltr" aria-hidden>
        <p className="overflow-hidden whitespace-nowrap">{l1}</p>
        <p className="overflow-hidden whitespace-nowrap">{l2}</p>
      </div>
    </div>
  )
}

/** The small numbers under the data page (only the ones switched on). */
export function BookStats({ book, stamps }: { book: BookFields | null; stamps: number }) {
  const items: { icon: string; v: number | string; en: string; ar: string }[] = [{ icon: '🛂', v: stamps, en: 'stamps', ar: 'ختم' }]
  if (book?.hours != null) items.push({ icon: '⏱️', v: book.hours, en: 'hours learning', ar: 'ساعة تعلّم' })
  if (book?.projects != null) items.push({ icon: '🛠️', v: book.projects, en: 'projects', ar: 'مشروع' })
  if (book?.certificates != null) items.push({ icon: '🎓', v: book.certificates, en: 'certificates', ar: 'شهادة' })
  if (book?.tracks && book.tracks.length) items.push({ icon: '🏅', v: book.tracks.length, en: 'tracks graduated', ar: 'مسار اتخرّج منه' })
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
      {items.map((x) => (
        <div key={x.en} className="rounded-xl border border-slate-200 bg-white p-2 text-center">
          <p className="text-lg font-bold text-slate-900">{x.icon} {x.v}</p>
          <p className="text-[11px] text-slate-500">{L(x.en, x.ar)}</p>
        </div>
      ))}
    </div>
  )
}

/** «My trips»: a travel log — each finished level is a trip, the running ones are «flying now». */
export function TripsPage({ trips, ar }: { trips: Trip[]; ar: boolean }) {
  if (!trips.length) return <p className="p-4 text-sm text-slate-500">{L('The first trip starts with the first level ✈️', 'أول رحلة بتبدأ مع أول مستوى ✈️')}</p>
  return (
    <ol className="relative space-y-3 border-s-2 border-dashed border-[#1E7FA0]/40 ps-5">
      {trips.map((t) => (
        <li key={t.id + t.status} className="relative">
          <span className="absolute -start-[1.85rem] top-1 flex h-6 w-6 items-center justify-center rounded-full text-xs text-white shadow" style={{ background: t.color }}>{t.status === 'DONE' ? '✓' : '✈'}</span>
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-sm font-semibold text-slate-900">{t.course} · {t.level}</p>
            <p className="text-xs text-slate-500">{t.track ? `${t.track} · ` : ''}{day(t.from, ar)} → {t.status === 'DONE' ? day(t.to, ar) : <b className="text-[#1E7FA0]">{L('flying now', 'في الطريق دلوقتي')}</b>}</p>
          </div>
        </li>
      ))}
    </ol>
  )
}

/** One visa page per track the child entered (the track's colour; «graduated» stamp when finished). */
export function VisasPage({ visas, ar, name }: { visas: Visa[]; ar: boolean; name: string }) {
  if (!visas.length) return <p className="p-4 text-sm text-slate-500">{L('The first visa comes with the first track 🌍', 'أول تأشيرة بتيجي مع أول مسار 🌍')}</p>
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {visas.map((v) => (
        <div key={v.trackId} className="keep-light relative overflow-hidden rounded-xl border-2 p-3 text-slate-900" style={{ ...PAPER, borderColor: v.color }}>
          <div className="mb-2 flex items-center justify-between rounded-md px-2 py-1 text-white" style={{ background: v.color }}>
            <p className={`text-xs font-bold ${ar ? '' : 'tracking-widest'}`}>{ar ? 'تأشيرة' : 'VISA'}</p>
            <p className="text-xs font-semibold">{v.name}</p>
          </div>
          <p className="text-[10px] uppercase tracking-wider" style={{ color: v.color }}>{ar ? 'صاحب التأشيرة' : 'Holder'}</p>
          <p className="truncate text-sm font-semibold">{name}</p>
          <p className="mt-1 text-[10px] uppercase tracking-wider" style={{ color: v.color }}>{ar ? 'دخل من' : 'Entered'}</p>
          <p className="text-sm">{day(v.since, ar)}</p>
          {v.graduated && (
            <div className="absolute bottom-2 end-2 rotate-[-12deg] rounded-md border-2 px-2 py-0.5 text-xs font-black" style={{ color: v.color, borderColor: v.color }}>{ar ? 'اتخرّج ✓' : 'GRADUATED ✓'}</div>
          )}
        </div>
      ))}
    </div>
  )
}
