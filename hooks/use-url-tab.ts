'use client'

/**
 * Tabs that can be opened from a link: /page?tab=settings (settings / reports centres link straight to a tab).
 * Returns [value, setValue]; value is null until the link or the user picks one, so the page keeps its own default:
 *   const [tab, setTab] = useUrlTab()
 *   <Tabs value={tab ?? 'list'} onValueChange={setTab}>
 * Reads window.location after mount (no useSearchParams → no Suspense needed, no hydration mismatch).
 */

import { useEffect, useState } from 'react'

export function useUrlTab(): [string | null, (v: string) => void] {
  const [tab, setTab] = useState<string | null>(null)
  useEffect(() => {
    try {
      const t = new URLSearchParams(window.location.search).get('tab')
      if (t) setTab(t)
    } catch { /* ignore */ }
  }, [])
  return [tab, setTab]
}
