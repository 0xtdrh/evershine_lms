'use client'

/**
 * a02 batch 3 (2026-10-31): room usage report — printable, outside the dashboard. /reports/rooms?campusId=
 * Every room of a place × weekday with the groups in it, hours booked per week. Data: /api/places/[campusId]/rooms.
 */

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { I18nProvider, L, LanguageSwitch, dayName, useI18n } from '@/lib/i18n/client'
import { Printer } from 'lucide-react'
import { cairoToday } from '@/lib/dates/cairo'

interface Place { id: string; name: string; label?: string; kind?: string }
interface Data {
  campus: { id: string; name: string; roomMode: string }
  settings: { sessionMinutes: number }
  rooms: { id: string; name: string; capacity: number; kind: string | null; isActive: boolean }[]
  dayCounts: number[]
  usage: { roomId: string; minutesPerWeek: number; sessions: { label: string; dayOfWeek: number; time: string }[] }[]
  unplaced: number
}

function View() {
  useI18n()
  const sp = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null
  const [campusId, setCampusId] = useState(sp?.get('campusId') || '')
  const { data: places = [] } = useQuery<Place[]>({ queryKey: ['campuses'], queryFn: () => fetchApi('/api/campuses') })
  const id = campusId || places.find((p) => p.kind !== 'ONLINE')?.id || ''
  const { data, error } = useQuery({ queryKey: ['place-rooms', id], queryFn: () => fetchApi<Data>(`/api/places/${id}/rooms`), enabled: !!id })
  const rooms = (data?.rooms ?? []).filter((r) => r.isActive)
  const days = [0, 1, 2, 3, 4, 5, 6]
  return (
    <div className="keep-light min-h-screen bg-gray-100 py-6 print:bg-white print:py-0">
      <style>{'@media print { @page { size: A4 landscape; margin: 10mm; } body { background: #fff; } }'}</style>
      <div className="mx-auto mb-4 flex max-w-5xl flex-wrap items-center justify-center gap-2 px-4 print:hidden">
        <select aria-label={L('Place', 'المكان')} className="h-9 rounded-md border px-2 text-sm" value={id} onChange={(e) => setCampusId(e.target.value)}>
          {places.filter((p) => p.kind !== 'ONLINE').map((p) => <option key={p.id} value={p.id}>{p.label ?? p.name}</option>)}
        </select>
        <Button onClick={() => window.print()}><Printer className="me-2 h-4 w-4" />{L('Print / PDF', 'اطبع / PDF')}</Button>
        <LanguageSwitch />
      </div>
      {error && <p className="text-center text-sm text-red-600">{(error as Error).message}</p>}
      {data && (
        <div className="mx-auto max-w-5xl bg-white p-6 text-sm text-black shadow print:shadow-none" data-document-page>
          <div className="mb-4 flex items-center justify-between border-b-4 pb-3" style={{ borderColor: '#1B4F8A' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/bglogo.png" alt="TechNova" className="h-10 w-auto" />
            <div className="text-end">
              <h1 className="text-lg font-bold" style={{ color: '#1B4F8A' }}>{L('Room usage', 'إشغال القاعات')}</h1>
              <p className="text-xs text-gray-600">{data.campus.name} · {L('a session =', 'الحصة =')} {data.settings.sessionMinutes} {L('min', 'دقيقة')}</p>
            </div>
          </div>
          {data.campus.roomMode !== 'FIXED' && <p className="py-6 text-center text-gray-500">{data.campus.roomMode === 'DAILY' ? L('This place keeps only a number of rooms per day.', 'المكان ده مسجّل عدد قاعات لكل يوم بس.') : L('This place does not keep rooms.', 'المكان ده مش مسجّل قاعاته.')}</p>}
          {data.campus.roomMode === 'FIXED' && (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="bg-gray-50"><th className="border p-1 text-start">{L('Room', 'القاعة')}</th>{days.map((d) => <th key={d} className="border p-1">{dayName(d)}</th>)}<th className="border p-1">{L('h / week', 'ساعة / أسبوع')}</th></tr>
                </thead>
                <tbody>
                  {rooms.map((r) => {
                    const u = data.usage.find((x) => x.roomId === r.id)
                    return (
                      <tr key={r.id}>
                        <td className="border p-1 font-semibold">{r.name} <span className="font-normal text-gray-500">({r.capacity})</span></td>
                        {days.map((d) => <td key={d} className="border p-1 align-top">{(u?.sessions ?? []).filter((s) => s.dayOfWeek === d).map((s, i) => <div key={i}>{s.time} {s.label}</div>)}</td>)}
                        <td className="border p-1 text-center font-semibold">{Math.round((u?.minutesPerWeek ?? 0) / 6) / 10}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {data.unplaced > 0 && <p className="mt-2 text-xs text-amber-700">⚠ {L(`${data.unplaced} weekly branch session(s) have no room.`, `${data.unplaced} حصة أسبوعية في الفرع ملهاش قاعة.`)}</p>}
            </div>
          )}
          <p className="mt-6 text-center text-xs text-gray-400">TechNova · {cairoToday()}</p>
        </div>
      )}
    </div>
  )
}

export default function RoomsReportPage() {
  return <I18nProvider><View /></I18nProvider>
}
