'use client'

/** a04: /reports/cash-day(?account=&campusId=) opens today's daily cash-close sheet (Cairo day). */

import { useEffect } from 'react'
import { cairoToday } from '@/lib/dates/cairo'

export default function CashDayToday() {
  useEffect(() => { window.location.replace(`/reports/cash-day/${cairoToday()}${window.location.search}`) }, [])
  return null
}
