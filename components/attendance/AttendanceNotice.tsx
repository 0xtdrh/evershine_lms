'use client'

/**
 * Owner 14/11: when attendance cannot be taken (group waiting for its minimum, month's sessions complete), the
 * screen shows WHY instead of the students. Staff get a link to the group page (start anyway / move to next month).
 */

import Link from 'next/link'
import { Hourglass, CalendarCheck2 } from 'lucide-react'
import { L, useI18n } from '@/lib/i18n/client'
import { localizeMessage } from '@/lib/i18n/api-messages'

export interface AttendanceNoticeData { code: 'GROUP_NOT_READY' | 'CYCLE_FULL'; message: string }

export function AttendanceNotice({ notice, groupId, staff }: { notice: AttendanceNoticeData; groupId: string; staff: boolean }) {
  const { locale } = useI18n()
  const Icon = notice.code === 'CYCLE_FULL' ? CalendarCheck2 : Hourglass
  return (
    <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 h-5 w-5 shrink-0" />
        <div className="space-y-2">
          <p className="font-semibold">
            {notice.code === 'CYCLE_FULL' ? L('This month is complete', 'الشهر ده خلص') : L('This group has not started yet', 'الجروب لسه مابدأش')}
          </p>
          <p className="text-sm">{localizeMessage(notice.message, locale)}</p>
          {staff ? (
            <Link href={`/dashboard/groups?group=${groupId}`} className="inline-block rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700">
              {notice.code === 'CYCLE_FULL' ? L('Open the group (move to next month)', 'افتح الجروب (انقله للشهر الجاي)') : L('Open the group', 'افتح الجروب')}
            </Link>
          ) : (
            <p className="text-xs text-amber-800">{L('Staff were told; nothing to do on your side.', 'الإدارة عارفة؛ مفيش حاجة مطلوبة منك.')}</p>
          )}
        </div>
      </div>
    </div>
  )
}
