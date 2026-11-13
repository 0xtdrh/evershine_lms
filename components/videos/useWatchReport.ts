'use client'

/**
 * Six phases 2: reports what a <video> really played (parts in video seconds) every 15 s, on pause and when the page closes,
 * and resumes where the student stopped. Only a student in a group is counted (the server ignores parents / staff).
 */

import { useEffect, useRef } from 'react'

type Range = [number, number]

export function useWatchReport(video: React.RefObject<HTMLVideoElement | null>, blockId: string, groupId?: string | null, ready = true) {
  const parts = useRef<Range[]>([])
  const cur = useRef<Range | null>(null)
  const last = useRef<number | null>(null)
  const opened = useRef(true)
  const resumed = useRef(false)
  const fast = useRef(0)
  const maxRate = useRef(1)

  useEffect(() => {
    const v = video.current
    if (!v || !groupId || !ready) return
    const flushCur = () => { if (cur.current && cur.current[1] - cur.current[0] > 0.2) parts.current.push(cur.current); cur.current = null }
    const send = (beacon = false) => {
      flushCur()
      const ranges = parts.current.splice(0)
      if (!ranges.length && !opened.current) return
      const body = JSON.stringify({ blockId, groupId, ranges, position: Math.floor(v.currentTime || 0), duration: Number.isFinite(v.duration) ? Math.round(v.duration) : null, opened: opened.current, fastSec: Math.round(fast.current), maxSpeed: maxRate.current })
      fast.current = 0
      maxRate.current = 1
      opened.current = false
      try {
        if (beacon && navigator.sendBeacon) navigator.sendBeacon('/api/lessons/watch', body)
        else void fetch('/api/lessons/watch', { method: 'POST', body, keepalive: true }).catch(() => null)
      } catch { /* the next report carries it */ }
    }
    const onTime = () => {
      const t = v.currentTime
      if (v.paused || v.seeking) { last.current = t; return }
      if (last.current != null && t >= last.current && t - last.current < 2) {
        if (!cur.current) cur.current = [last.current, t]
        else cur.current[1] = t
        // who speeds up: video seconds played faster than 1×
        if (v.playbackRate > 1.05) { fast.current += t - last.current; maxRate.current = Math.max(maxRate.current, v.playbackRate) }
      } else flushCur()
      last.current = t
    }
    const onSeek = () => { flushCur(); last.current = v.currentTime }
    const onPause = () => send()
    const onMeta = async () => {
      if (resumed.current) return
      resumed.current = true
      try {
        const r = await fetch(`/api/lessons/watch?blockId=${encodeURIComponent(blockId)}&groupId=${encodeURIComponent(groupId)}`).then((x) => x.json())
        const pos = Number(r?.data?.lastPosition ?? 0)
        if (pos > 5 && Number.isFinite(v.duration) && pos < v.duration - 10 && v.currentTime < 1) v.currentTime = pos
      } catch { /* start from the beginning */ }
    }
    const onHide = () => { if (document.visibilityState === 'hidden') send(true) }
    v.addEventListener('timeupdate', onTime)
    v.addEventListener('seeking', onSeek)
    v.addEventListener('pause', onPause)
    v.addEventListener('ended', onPause)
    v.addEventListener('loadedmetadata', onMeta)
    if (v.readyState >= 1) void onMeta()
    document.addEventListener('visibilitychange', onHide)
    const t = setInterval(() => { if (!v.paused) send() }, 15_000)
    return () => {
      clearInterval(t)
      send(true)
      v.removeEventListener('timeupdate', onTime)
      v.removeEventListener('seeking', onSeek)
      v.removeEventListener('pause', onPause)
      v.removeEventListener('ended', onPause)
      v.removeEventListener('loadedmetadata', onMeta)
      document.removeEventListener('visibilitychange', onHide)
    }
  }, [video, blockId, groupId, ready])
}
