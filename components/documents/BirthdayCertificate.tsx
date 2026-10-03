'use client'

/**
 * Birthday certificate (A4). Used by Documents (staff) and /birthday-card/[studentId]
 * (parents, students, staff — phase C). Printable/exported areas stay light (data-document-page).
 */

import { AcademyLogo } from '@/components/AcademyLogo'

function formatName(first?: string, last?: string) {
  const parts = [first?.trim(), last?.trim()].filter(Boolean) as string[]
  if (!parts.length) return '—'
  return parts.join(' ').replace(/\s+/g, ' ').split(' ').map((w) => (w.length ? w[0].toUpperCase() + w.slice(1).toLowerCase() : '')).join(' ')
}

export function avatarDataUrl(firstName: string, lastName: string, bgColor: string) {
  const initials = ((firstName?.[0] || '') + (lastName?.[0] || '')).toUpperCase()
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256"><rect width="256" height="256" fill="${bgColor}"/><text x="50%" y="55%" dominant-baseline="middle" text-anchor="middle" fill="#ffffff" font-family="Arial, sans-serif" font-size="100" font-weight="bold">${initials}</text></svg>`
  const base64 = typeof window !== 'undefined'
    ? btoa(encodeURIComponent(svg).replace(/%([0-9A-F]{2})/g, (_, p1) => String.fromCharCode(parseInt(p1, 16))))
    : Buffer.from(svg).toString('base64')
  return `data:image/svg+xml;base64,${base64}`
}

export interface BirthdayCertificateProps {
  firstName: string
  lastName: string
  dateOfBirth: string | Date | null | undefined
  photoSrc?: string | null
  groupLabel: string
  registrationNumber: string
}

export function BirthdayCertificate({ firstName, lastName, dateOfBirth, photoSrc, groupLabel, registrationNumber }: BirthdayCertificateProps) {
  return (
    <div
          data-document-page
          data-pdf-width="794"
          data-pdf-height="1123"
          className="w-[794px] bg-[#eff6ff] border-[14px] border-solid border-[#1e3a8a] flex flex-col items-center relative overflow-hidden shrink-0"
          style={{ fontFamily: 'Georgia, serif', minHeight: '1123px', height: '1123px', boxSizing: 'border-box', boxShadow: 'inset 0 0 40px rgba(30,58,138,0.15)' }}
        >
          <div className="absolute inset-x-0 top-32 flex justify-center pointer-events-none opacity-5">
            <div className="w-[360px] h-[360px]">
              <AcademyLogo variant="icon" theme="mono-black" className="w-full h-full" />
            </div>
          </div>
          {/* Student-blue ornamental inner borders */}
          <div className="absolute inset-[8px] border border-[#1e3a8a]/40 pointer-events-none" />
          <div className="absolute inset-[14px] border border-[#1e3a8a]/20 pointer-events-none" />
          {/* Corner Ornaments */}
          <div className="absolute top-4 left-4 w-10 h-10 border-t-2 border-l-2 border-[#1e3a8a]" />
          <div className="absolute top-4 right-4 w-10 h-10 border-t-2 border-r-2 border-[#1e3a8a]" />
          <div className="absolute bottom-4 left-4 w-10 h-10 border-b-2 border-l-2 border-[#1e3a8a]" />
          <div className="absolute bottom-4 right-4 w-10 h-10 border-b-2 border-r-2 border-[#1e3a8a]" />
          {/* Logo & Header */}
          <div className="mt-12 w-full max-w-md rounded-2xl border border-[#1e3a8a]/30 bg-white/90 p-4 shadow-md flex flex-col items-center gap-1.5 relative z-10 text-center">
            <div className="rounded-full border border-[#1e3a8a]/40 bg-white p-2 flex items-center justify-center shadow-inner">
              <AcademyLogo className="w-10 h-10 text-[#1e3a8a]" />
            </div>
            <div className="text-center w-full">
              <h2 className="text-[#1e3a8a] text-[20px] font-black uppercase tracking-[0.2em] leading-tight">TechNova</h2>
              <p className="text-[9px] text-gray-500 uppercase tracking-widest font-black mt-1">STEM · Robotics · Programming</p>
              <p className="text-[8px] text-gray-600 font-bold leading-normal mt-0.5 max-w-[300px] mx-auto">El Kawthar, Hurghada, Egypt</p>
              <p className="text-[9px] text-[#1e3a8a] font-black mt-1">TechNova · El Kawthar, Hurghada, Egypt</p>
            </div>
          </div>
          <div className="w-3/4 h-[2px] bg-gradient-to-r from-transparent via-[#1e3a8a] to-transparent my-6 relative z-10" />
          {/* Student Photo */}
          <div className="w-28 h-28 rounded-full border-4 border-[#1e3a8a] overflow-hidden bg-white flex items-center justify-center shadow-md relative z-10 shrink-0">
            <img
              src={photoSrc || avatarDataUrl(firstName, lastName, '#1e3a8a')}
              alt={`${firstName} ${lastName}`}
              width={112}
              height={112}
              className="w-full h-full object-cover object-center shrink-0"
              style={{ objectFit: 'cover', objectPosition: 'center' }}
            />
          </div>
          {/* Title */}
          <div className="relative z-10 mt-5 w-full flex flex-col items-center text-center px-6">
            <h1 className="text-[32px] font-black text-gray-900 uppercase tracking-widest leading-tight text-center w-full">
              Birthday Certificate
            </h1>
            <p className="text-[13px] italic text-gray-500 mt-2 font-medium leading-snug text-center">This certificate of blessing is joyfully awarded to</p>
          </div>
          {/* Student Name */}
          <div className="relative z-10 mt-5 w-full flex flex-col items-center text-center px-6">
            <div className="text-center w-full">
              <h2 className="text-[28px] font-black text-[#1e3a8a] tracking-[0.08em] leading-tight text-center inline-block pb-1 border-b-2 border-[#1e3a8a]">
                {formatName(firstName, lastName)}
              </h2>
            </div>
            <p className="text-[11px] text-gray-600 font-bold uppercase mt-4 tracking-[0.2em] bg-white/90 px-4 py-1.5 rounded-full border border-gray-200 whitespace-nowrap shadow-sm">
              Group: {groupLabel} <span className="mx-2 text-[#1e3a8a]">•</span> Reg. No: {registrationNumber}
            </p>
          </div>
          {/* Message Body */}
          <p className="text-[13px] text-gray-700 max-w-lg text-center leading-relaxed mt-6 px-6 font-medium relative z-10">
            On this beautiful day, the administration and faculty of TechNova come together to celebrate your life and academic progress. We wish you an abundance of joy, wisdom, sound health, and spectacular future endeavors. Keep shining and climbing high!
          </p>
          {/* Date Details */}
          <div className="mt-6 flex flex-col items-center bg-white px-8 py-3.5 rounded-xl border border-[#1e3a8a]/20 shadow-sm relative z-10">
            <span className="text-[10px] uppercase font-bold text-gray-500 tracking-[0.2em]">Date of Birth</span>
            <span className="text-[16px] font-black text-gray-900 mt-1 uppercase tracking-[0.12em] leading-tight text-center whitespace-nowrap">
              {dateOfBirth && !isNaN(new Date(dateOfBirth).getTime()) ? new Date(dateOfBirth).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC' }) : 'Unknown Date'}
            </span>
          </div>
          <div className="flex-1 min-h-[24px]" />
          <div className="w-full px-12 flex items-end justify-between mb-8 relative z-10">
            <div className="flex gap-12 flex-nowrap shrink-0">
              <div className="flex flex-col items-center">
                <div className="w-36 border-b-2 border-gray-400 pb-1 flex items-end justify-center h-12">
                  <span className="font-serif italic text-[12px] text-gray-300 whitespace-nowrap">Principal Stamp</span>
                </div>
                <span className="text-[10px] uppercase font-bold text-gray-600 mt-1.5 tracking-widest whitespace-nowrap">Academy Principal</span>
              </div>
              <div className="flex flex-col items-center">
                <div className="w-36 border-b-2 border-gray-400 pb-1 flex items-end justify-center h-12">
                  <span className="font-serif italic text-[12px] text-gray-300 whitespace-nowrap">Teacher Seal</span>
                </div>
                <span className="text-[10px] uppercase font-bold text-gray-600 mt-1.5 tracking-widest whitespace-nowrap">Class Teacher</span>
              </div>
            </div>
          </div>
        </div>
  )
}
