'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { L, useI18n } from '@/lib/i18n/client'
import { attendanceTarget } from '@/lib/attendance/entry'

/**
 * /dashboard/attendance is only an entry point: every staff role and instructor goes to the group attendance screen
 * (/dashboard/attendance/sections — places + instructor checks in lib/attendance/access.ts). Final test 18/11: branch
 * managers, secretaries and accountants used to land on the old template roster (all English). Students and parents go to
 * their own attendance view. The old roster stays at /dashboard/attendance/legacy (Super Admin / Admin, "Old screens").
 */
export default function AttendanceEntryPage() {
  useI18n() // re-render on a language switch
  const router = useRouter()
  const { data: session, status } = useSession()
  const target = attendanceTarget(session?.user?.role)

  useEffect(() => {
    if (status === 'authenticated' && target) router.replace(target)
  }, [status, target, router])

  return <div className="p-8 text-center text-sm text-gray-500">{L('Opening attendance…', 'بيفتح الحضور…')}</div>
}
