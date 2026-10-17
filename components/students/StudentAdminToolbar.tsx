'use client'

import { useMyPermissions } from '@/hooks/use-my-permissions'
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { useSession } from 'next-auth/react'
import { fetchApi } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { UserX, UserCheck, ArrowUpCircle, CreditCard, FileText, Loader2 } from 'lucide-react'
import { notify } from '@/lib/notify'
import type { StudentEnrollmentRow } from './StudentEnrollmentsPanel'
import { L } from '@/lib/i18n/client'

interface Props {
  studentId: string
  registrationNumber: string
  enrollmentStatus: string
  enrollments?: StudentEnrollmentRow[]
}

export function StudentAdminToolbar({
  studentId,
  registrationNumber,
  enrollmentStatus,
  enrollments = [],
}: Props) {
  const router = useRouter()
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const { data: session } = useSession()
  const isAdmin = session?.user?.role === 'SUPER_ADMIN' || session?.user?.role === 'ADMIN'
  const { can } = useMyPermissions()
  const canSuspend = can('students', 'update') // PATCH /api/students/[id], /reactivate

  const primaryEnrollment = enrollments.find((e) => e.status === 'ACTIVE')

  const promotionHref = primaryEnrollment
    ? `/dashboard/promotions?studentId=${studentId}&fromYearId=${primaryEnrollment.academicYear.id}&fromSectionId=${primaryEnrollment.classSection.id}`
    : `/dashboard/promotions?studentId=${studentId}`

  const handleSuspend = async () => {
    if (!confirm(`Suspend ${registrationNumber}? Login will be disabled.`)) return
    setBusy(true)
    try {
      await fetchApi(`/api/students/${studentId}`, { method: 'DELETE' })
      notify.success(L('Student suspended', 'الطالب اتوقف'))
      qc.invalidateQueries({ queryKey: ['student', studentId] })
      router.refresh()
    } catch (err: unknown) {
      notify.error(err instanceof Error ? err.message : 'Failed')
    } finally {
      setBusy(false)
    }
  }

  const handleReactivate = async () => {
    setBusy(true)
    try {
      await fetchApi(`/api/students/${studentId}/reactivate`, { method: 'POST' })
      notify.success(L('Student reactivated', 'الطالب اتفعّل تاني'))
      qc.invalidateQueries({ queryKey: ['student', studentId] })
      router.refresh()
    } catch (err: unknown) {
      notify.error(err instanceof Error ? err.message : 'Failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Link href={`/dashboard/fees?studentId=${studentId}`}>
        <Button variant="outline" size="sm" className="gap-1 text-xs h-8">
          <CreditCard className="w-3.5 h-3.5" /> {L('Fees', 'الفواتير')}
        </Button>
      </Link>
      {isAdmin && (
        <Link href={`/dashboard/documents?studentId=${studentId}&doc=id_card`}>
          <Button variant="outline" size="sm" className="gap-1 text-xs h-8">
            <FileText className="w-3.5 h-3.5" /> {L('ID Card', 'الكارنيه')}
          </Button>
        </Link>
      )}
      <Link href={promotionHref}>
        <Button variant="outline" size="sm" className="gap-1 text-xs h-8">
          <ArrowUpCircle className="w-3.5 h-3.5" /> {L('Promote', 'ترقية')}
        </Button>
      </Link>
      {!canSuspend ? null : enrollmentStatus === 'SUSPENDED' ? (
        <Button
          variant="outline"
          size="sm"
          className="gap-1 text-xs h-8 text-green-700 border-green-200"
          disabled={busy}
          onClick={handleReactivate}
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserCheck className="w-3.5 h-3.5" />}
          {L('Reactivate', 'فعّل تاني')}
        </Button>
      ) : (
        <Button
          variant="outline"
          size="sm"
          className="gap-1 text-xs h-8 text-red-700 border-red-200"
          disabled={busy}
          onClick={handleSuspend}
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserX className="w-3.5 h-3.5" />}
          {L('Suspend', 'إيقاف')}
        </Button>
      )}
    </div>
  )
}
