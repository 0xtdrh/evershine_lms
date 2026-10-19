'use client'

/**
 * 2026-10-19 the TechNova ID card (85.6 × 54 mm, credit-card size). Front: photo, names, number, place, track colour
 * band (students) or job (staff). Back: QR (link to /card/<code>), emergency phone, valid until. Always light (print).
 */

import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

export interface IdCardData {
  kind: 'STUDENT' | 'STAFF'; id: string; code: string
  nameEn: string; nameAr: string | null; number: string; place: string; role: string | null
  track: string | null; color: string; photo: string | null; emergency: string | null
  issuedAt: string; validUntil: string
}

const dmy = (iso: string) => { const d = new Date(iso); return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}` }
const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('')

const CARD: React.CSSProperties = { width: '85.6mm', height: '54mm', borderRadius: '3mm', overflow: 'hidden', position: 'relative', boxSizing: 'border-box', fontFamily: 'Tahoma, Arial, sans-serif', background: '#ffffff', color: '#0f172a', border: '0.2mm solid #e2e8f0' }

export function CardFront({ c }: { c: IdCardData }) {
  return (
    <div className="keep-light" style={CARD}>
      <div style={{ background: c.color, height: '11mm', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 3mm', color: '#fff' }}>
        <img src="/brand/bglogo.png" alt="TechNova" style={{ height: '7mm', background: '#fff', borderRadius: '1.5mm', padding: '0.5mm 1mm' }} />
        <span style={{ fontSize: '2.6mm', fontWeight: 700, letterSpacing: '0.3mm' }}>{c.kind === 'STUDENT' ? 'STUDENT · طالب' : 'STAFF · موظف'}</span>
      </div>
      <div style={{ display: 'flex', gap: '3mm', padding: '3mm' }}>
        <div style={{ width: '20mm', height: '25mm', borderRadius: '2mm', overflow: 'hidden', background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, border: `0.6mm solid ${c.color}` }}>
          {c.photo ? <img src={c.photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ fontSize: '7mm', fontWeight: 700, color: '#94a3b8' }}>{initials(c.nameEn)}</span>}
        </div>
        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: '0.8mm' }}>
          {c.nameAr && <div dir="rtl" style={{ fontSize: '3.4mm', fontWeight: 700, lineHeight: 1.2 }}>{c.nameAr}</div>}
          <div style={{ fontSize: c.nameAr ? '2.9mm' : '3.6mm', fontWeight: c.nameAr ? 500 : 700, lineHeight: 1.2 }}>{c.nameEn}</div>
          <div style={{ fontSize: '2.6mm', color: '#475569', marginTop: '1mm' }}>{c.kind === 'STUDENT' ? 'Reg. No' : 'ID'}: <b style={{ color: '#0f172a' }}>{c.number}</b></div>
          <div style={{ fontSize: '2.6mm', color: '#475569' }}>{c.place}</div>
          {(c.track || c.role) && <div style={{ marginTop: '1mm', alignSelf: 'flex-start', background: c.color, color: '#fff', borderRadius: '5mm', padding: '0.5mm 2.5mm', fontSize: '2.5mm', fontWeight: 700 }}>{c.track ?? c.role}</div>}
        </div>
      </div>
    </div>
  )
}

export function CardBack({ c, origin }: { c: IdCardData; origin: string }) {
  const [qr, setQr] = useState<string | null>(null)
  useEffect(() => { QRCode.toDataURL(`${origin}/card/${encodeURIComponent(c.code)}`, { margin: 1, width: 300 }).then(setQr).catch(() => setQr(null)) }, [c.code, origin])
  return (
    <div className="keep-light" style={{ ...CARD, display: 'flex', alignItems: 'center', gap: '3mm', padding: '3mm' }}>
      <div style={{ width: '30mm', height: '30mm', flexShrink: 0, background: '#fff' }}>{qr && <img src={qr} alt="QR" style={{ width: '100%', height: '100%' }} />}</div>
      <div style={{ fontSize: '2.5mm', lineHeight: 1.5, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: '3mm', color: c.color }}>TechNova</div>
        <div>STEM · Robotics · Programming</div>
        {c.emergency && <div style={{ marginTop: '1mm' }}>Emergency · طوارئ: <b dir="ltr">{c.emergency}</b></div>}
        <div style={{ marginTop: '1mm' }}>Valid until · صالح لحد: <b>{dmy(c.validUntil)}</b></div>
        <div style={{ marginTop: '1mm', color: '#64748b', fontSize: '2.2mm' }}>If found, please return it to TechNova. · لو لقيته رجّعه لـ TechNova.</div>
      </div>
    </div>
  )
}
