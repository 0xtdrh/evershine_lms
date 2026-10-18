'use client'

/** 2026-10-18 usage report: tells the server "still here" every minute while this tab is visible (no UI). */

import { useEffect } from 'react'

const EVERY_MS = 60_000

export function ActivityPing() {
  useEffect(() => {
    let last = 0
    const ping = () => {
      if (document.visibilityState !== 'visible' || Date.now() - last < EVERY_MS - 5_000) return
      last = Date.now()
      fetch('/api/activity/ping', { method: 'POST', credentials: 'same-origin', keepalive: true }).catch(() => {})
    }
    ping()
    const id = window.setInterval(ping, EVERY_MS)
    document.addEventListener('visibilitychange', ping)
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', ping) }
  }, [])
  return null
}
