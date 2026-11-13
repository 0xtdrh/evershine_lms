'use client'

/** Six phases 1-C: the group's booking link + QR (families open it, sign in or make an account, and book this group) + counts. */

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link2 } from 'lucide-react'
import { fetchApi } from '@/lib/api-client'
import { L } from '@/lib/i18n/client'
import { LinkQrBox } from '@/components/common/LinkQrBox'

type Stats = { slug: string | null; path: string; bookings: number; confirmed: number }

export function GroupBookingLink({ groupId, groupName }: { groupId: string; groupName: string }) {
  const [open, setOpen] = useState(false)
  const { data } = useQuery({ queryKey: ['group-booking-link', groupId], queryFn: () => fetchApi<Stats>(`/api/groups/${groupId}/booking-link`), enabled: open, retry: false })
  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <button type="button" onClick={() => setOpen((x) => !x)} aria-expanded={open} className="flex w-full items-center gap-2 text-sm font-medium text-slate-700">
        <Link2 className="h-4 w-4 text-indigo-600" aria-hidden /> {L('Booking link & QR', 'لينك الحجز و QR')}
      </button>
      {open ? (
        !data ? <p className="mt-2 text-sm text-slate-500">{L('Loading…', 'بيحمّل…')}</p>
          : !data.slug ? <p className="mt-2 text-sm text-amber-700">{L('This group’s course is not on the website courses page yet (Website → Courses), so families cannot book it online.', 'كورس الجروب ده لسه مش في صفحة الكورسات على الموقع (الموقع ← الكورسات)، فالعائلات مش هتقدر تحجزه أونلاين.')}</p>
          : (
            <div className="mt-2 space-y-2">
              <LinkQrBox path={data.path} fileName={`book-${groupId}`} whatsappText={`احجز مكان في جروب ${groupName} في TechNova:`} />
              <p className="text-sm text-slate-600">{L(`${data.bookings} bookings from this link (${data.confirmed} confirmed)`, `${data.bookings} حجز من اللينك ده (${data.confirmed} اتأكد)`)}</p>
            </div>
          )
      ) : null}
    </div>
  )
}
