'use client'

/** Phase 6 browser helpers: download a file from our API (with the session cookie) and save it. */

export async function downloadFrom(url: string, fallbackName: string, init?: RequestInit) {
  const res = await fetch(url, { credentials: 'same-origin', ...init })
  if (!res.ok) {
    const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
    throw new Error(j?.error?.message || `Download failed (${res.status})`)
  }
  const blob = await res.blob()
  const cd = res.headers.get('content-disposition') ?? ''
  const m = cd.match(/filename\*=UTF-8''([^;]+)/) ?? cd.match(/filename="([^"]+)"/)
  const name = m ? decodeURIComponent(m[1]) : fallbackName
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 4000)
}

export const filterQuery = (f: Record<string, string | null | undefined>) =>
  Object.entries(f).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&')
