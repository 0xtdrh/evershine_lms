'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import LegacyAttendancePage from './legacy/page'
import { L, useI18n } from '@/lib/i18n/client'

/**
 * Academic engine: admins and teachers use section attendance.
 * Legacy class roster remains at /dashboard/attendance/legacy.
 */
export default function AttendanceEntryPage() {
  useI18n() // re-render on a language switch
  const router = useRouter()
  const { data: session, status } = useSession()
  const role = session?.user?.role
  const useEngine =
    role === 'SUPER_ADMIN' || role === 'ADMIN' || role === 'TEACHER'

  useEffect(() => {
    if (status === 'authenticated' && useEngine) {
      router.replace('/dashboard/attendance/sections')
    }
  }, [status, useEngine, router])

  if (status === 'loading') {
    return <div className="p-8 text-center text-gray-500 text-sm">{L('Loading attendance…', 'بيحمّل الحضور…')}</div>
  }

  if (useEngine) {
    return (
      <div className="p-8 text-center text-gray-500 text-sm">
        {L('Redirecting to section attendance…', 'بيوديك لحضور الجروب…')}
      </div>
    )
  }

  return <LegacyAttendancePage />
}
