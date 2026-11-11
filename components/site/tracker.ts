'use client'

/**
 * x01 analytics in the browser: one session id per tab (sessionStorage), a visitor id only after the visitor accepts
 * the cookie notice (localStorage), a ping every 15 s while the tab is visible, and events. Never throws, never waits.
 */

import { useEffect } from 'react'
import { MAX_VISIT_SECONDS, PING_SECONDS, type EventKind } from '@/lib/site/visit-rules'

const URL_ = '/api/public/site-track'
type Consent = 'yes' | 'no' | null

const store = {
  get(kind: 'local' | 'session', k: string): string | null {
    try { return (kind === 'local' ? window.localStorage : window.sessionStorage).getItem(k) } catch { return null }
  },
  set(kind: 'local' | 'session', k: string, v: string) {
    try { (kind === 'local' ? window.localStorage : window.sessionStorage).setItem(k, v) } catch { /* private mode */ }
  },
}
const newId = () => {
  try { return crypto.randomUUID().replace(/-/g, '') } catch { return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}` }
}

let sid: string | null = null
export const getSid = () => sid ?? ''
export const getConsent = (): Consent => (store.get('local', 'tn_consent') as Consent) ?? null

function send(body: Record<string, unknown>) {
  const yes = getConsent() === 'yes'
  const data = JSON.stringify({ vid: yes ? store.get('local', 'tn_vid') : null, ...body, sid, consent: yes })
  try {
    if (navigator.sendBeacon && navigator.sendBeacon(URL_, new Blob([data], { type: 'application/json' }))) return
  } catch { /* fall back */ }
  fetch(URL_, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: data, keepalive: true }).catch(() => undefined)
}

export function track(kind: EventKind, label?: string) {
  if (!sid) return
  send({ t: 'event', kind, label: label?.slice(0, 80), path: location.pathname + location.hash })
}

export function setConsent(v: 'yes' | 'no') {
  store.set('local', 'tn_consent', v)
  if (v === 'yes' && !store.get('local', 'tn_vid')) store.set('local', 'tn_vid', newId())
  if (v === 'yes' && sid) send({ t: 'ping' })
}

export function useSiteTracker(lang: string) {
  useEffect(() => {
    sid = store.get('session', 'tn_sid')
    const fresh = !sid
    if (!sid) { sid = newId(); store.set('session', 'tn_sid', sid) }
    const q = new URLSearchParams(location.search)
    if (fresh) {
      send({
        t: 'start', vid: getConsent() === 'yes' ? store.get('local', 'tn_vid') : null, path: location.pathname + location.search.slice(0, 120),
        ref: document.referrer || null, lang, utm: { source: q.get('utm_source'), medium: q.get('utm_medium'), campaign: q.get('utm_campaign') },
      })
    } else {
      send({ t: 'page', path: location.pathname })
    }
    let spent = 0
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible' || spent >= MAX_VISIT_SECONDS) return
      spent += PING_SECONDS
      send({ t: 'ping' })
    }, PING_SECONDS * 1000)
    return () => window.clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
