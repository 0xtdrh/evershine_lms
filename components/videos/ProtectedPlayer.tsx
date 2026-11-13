'use client'

/**
 * a02 M4 batch 3: the player of a protected video. It asks the server for a short-lived viewing only when the person presses play, shows
 * the viewer's name moving over the picture (never on the black bars) and stops if the name is removed. Full screen is on the box, not on
 * the video, so the name stays on top; iPhone has no such full screen, so the box fills the page instead (not yet tried on a real iPhone).
 */

import { useWatchReport } from './useWatchReport'
import { useCallback, useEffect, useRef, useState } from 'react'
import type Hls from 'hls.js'
import { fetchApi } from '@/lib/api-client'
import { L, useI18n } from '@/lib/i18n/client'
import { HEARTBEAT_MS, pictureRect } from '@/lib/videos/rules'
import { Loader2, Maximize, Minimize, Pause, Play, RotateCcw, RotateCw, Volume2, VolumeX } from 'lucide-react'

const load = (k: string, d: string) => { try { return localStorage.getItem(k) ?? d } catch { return d } }
const keep = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* private window */ } }
const deviceId = () => { let d = load('tn_video_device', ''); if (!d) { d = crypto.getRandomValues(new Uint32Array(3)).join('-'); keep('tn_video_device', d) } return d }
const clock = (s: number) => (Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '0:00')
const btn = 'flex h-8 min-w-8 items-center justify-center rounded-md bg-white/15 px-1.5 text-xs text-white hover:bg-white/25'

export function ProtectedPlayer({ blockId, g, s, className = '', groupId }: { blockId: string; g?: string | null; s?: string | null; className?: string; groupId?: string | null }) {
  useI18n()
  const box = useRef<HTMLDivElement>(null), video = useRef<HTMLVideoElement>(null), mark = useRef<HTMLDivElement>(null)
  const hls = useRef<Hls | null>(null), token = useRef<string | null>(null), hideT = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [error, setError] = useState('')
  const [name, setName] = useState('')
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0), [duration, setDuration] = useState(0)
  const [muted, setMuted] = useState(false), [volume, setVolume] = useState(1), [canVolume, setCanVolume] = useState(true)
  const [speed, setSpeed] = useState('1'), [full, setFull] = useState(false), [pageFull, setPageFull] = useState(false), [bar, setBar] = useState(true)

  // six phases 2: real watch minutes + resume where the student stopped
  useWatchReport(video, blockId, groupId, state === 'ready')

  const showBar = useCallback(() => {
    setBar(true)
    if (hideT.current) clearTimeout(hideT.current)
    hideT.current = setTimeout(() => { if (video.current && !video.current.paused) setBar(false) }, 3500)
  }, [])

  const close = useCallback(() => {
    hls.current?.destroy(); hls.current = null
    if (token.current) { try { navigator.sendBeacon('/api/videos/heartbeat', JSON.stringify({ token: token.current, end: true })) } catch { /* the link dies by itself */ } token.current = null }
  }, [])
  useEffect(() => close, [close])

  // the name moves inside the real picture; if it is removed or hidden the video stops
  useEffect(() => {
    if (state !== 'ready') return
    const move = () => {
      const b = box.current, v = video.current, m = mark.current
      if (!b || !v || !m) return
      const r = pictureRect(b.clientWidth, b.clientHeight, v.videoWidth, v.videoHeight)
      m.style.left = `${r.left + Math.random() * Math.max(0, r.width - m.offsetWidth)}px`
      m.style.top = `${r.top + Math.random() * Math.max(0, r.height * 0.8 - m.offsetHeight)}px`
    }
    move()
    const a = setInterval(move, 4000)
    const c = setInterval(() => {
      const b = box.current, v = video.current, m = mark.current
      if (!b || !v || v.paused) return
      const st = m && b.contains(m) ? getComputedStyle(m) : null
      if (!st || st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) < 0.2 || !m!.offsetWidth) { v.pause(); setError(L('The video stopped: the name was removed.', 'الفيديو وقف: الاسم اتشال.')) }
    }, 1000)
    const h = setInterval(() => {
      if (!token.current) return
      fetch('/api/videos/heartbeat', { method: 'POST', body: JSON.stringify({ token: token.current }) }).then((r) => {
        if (r.status === 403) { video.current?.pause(); setError(L('This viewing ended. Press play to start again.', 'المشاهدة دي انتهت. دوس تشغيل تبدأ تاني.')); close(); setState('idle') }
      }).catch(() => { /* the network may come back */ })
    }, HEARTBEAT_MS)
    return () => { clearInterval(a); clearInterval(c); clearInterval(h) }
  }, [state, close])

  const start = useCallback(async () => {
    const v = video.current
    if (!v) return
    setState('loading'); setError('')
    try {
      const out = await fetchApi<{ token: string; manifest: string; name: string }>('/api/videos/play', { method: 'POST', body: JSON.stringify({ blockId, g, s, device: deviceId() }) })
      token.current = out.token; setName(out.name)
      v.volume = Number(load('tn_video_volume', '1')); v.muted = load('tn_video_muted', '0') === '1'
      const wanted = load('tn_video_speed', '1'); setSpeed(wanted)
      // iPhone does not let a page set the volume: the side buttons do it
      const was = v.volume; v.volume = was === 0.5 ? 0.6 : 0.5; setCanVolume(v.volume !== was); v.volume = was
      const { default: HlsClass } = await import('hls.js')
      if (HlsClass.isSupported()) {
        const h = new HlsClass(); hls.current = h
        h.loadSource(out.manifest); h.attachMedia(v)
        h.on(HlsClass.Events.ERROR, (_e, d) => {
          if (!d.fatal) return
          setError(d.response?.code === 403 ? L('You cannot open this video now.', 'مش تقدر تفتح الفيديو دلوقتي.') : L('The video could not load. Check the internet and try again.', 'الفيديو ما اتحملش. راجع النت وجرّب تاني.'))
          close(); setState('error')
        })
      } else if (v.canPlayType('application/vnd.apple.mpegurl')) v.src = out.manifest
      else throw new Error(L('This browser cannot play the video.', 'المتصفح ده مش بيشغّل الفيديو.'))
      setState('ready')
      v.playbackRate = Number(wanted)
      await v.play().catch(() => { /* the person presses play */ })
    } catch (e) { setError((e as Error).message); setState('error') }
  }, [blockId, g, s, close])

  const toggle = () => { const v = video.current; if (!v) return; if (state !== 'ready') { void start(); return } if (v.paused) void v.play(); else v.pause() }
  const skip = (n: number) => { const v = video.current; if (v) v.currentTime = Math.max(0, Math.min((v.duration || 0) - 0.5, v.currentTime + n)) }
  const toggleFull = async () => {
    if (document.fullscreenElement) { await document.exitFullscreen(); return }
    if (pageFull) { setPageFull(false); return }
    try { if (!box.current?.requestFullscreen) throw new Error('none'); await box.current.requestFullscreen() } catch { setPageFull(true) }
  }
  useEffect(() => { const f = () => setFull(!!document.fullscreenElement); document.addEventListener('fullscreenchange', f); return () => document.removeEventListener('fullscreenchange', f) }, [])

  const onKey = (e: React.KeyboardEvent) => {
    const v = video.current
    if (!v || ['INPUT', 'SELECT'].includes((e.target as HTMLElement).tagName)) return
    if (e.key === ' ') { e.preventDefault(); toggle() } else if (e.key === 'ArrowLeft') skip(-10); else if (e.key === 'ArrowRight') skip(10)
    else if (e.key === 'ArrowUp') { e.preventDefault(); v.volume = Math.min(1, v.volume + 0.1); v.muted = false } else if (e.key === 'ArrowDown') { e.preventDefault(); v.volume = Math.max(0, v.volume - 0.1) }
    else if (e.key === 'm') v.muted = !v.muted; else if (e.key === 'f') void toggleFull()
    showBar()
  }

  return (
    <div ref={box} tabIndex={0} onKeyDown={onKey} onPointerMove={showBar} onPointerDown={showBar} onContextMenu={(e) => e.preventDefault()}
      className={`keep-light relative select-none overflow-hidden rounded-lg bg-black outline-none ${pageFull ? 'fixed inset-0 z-50 h-dvh w-screen rounded-none' : full ? 'h-full w-full' : `aspect-video w-full max-w-3xl ${className}`}`}>
      <video ref={video} playsInline disablePictureInPicture disableRemotePlayback className="h-full w-full" onClick={toggle}
        onPlay={() => { setPlaying(true); showBar() }} onPause={() => { setPlaying(false); setBar(true) }}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)} onLoadedMetadata={(e) => { setDuration(e.currentTarget.duration); e.currentTarget.playbackRate = Number(load('tn_video_speed', '1')) }} onDurationChange={(e) => setDuration(e.currentTarget.duration)}
        onVolumeChange={(e) => { setMuted(e.currentTarget.muted); setVolume(e.currentTarget.volume); keep('tn_video_volume', String(e.currentTarget.volume)); keep('tn_video_muted', e.currentTarget.muted ? '1' : '0') }} />
      {state === 'ready' && name && <div ref={mark} data-video-name className="pointer-events-none absolute z-10 whitespace-nowrap text-xs font-bold text-white opacity-60 transition-all duration-1000 sm:text-sm" style={{ textShadow: '0 0 3px #000' }}>{name}</div>}
      {state !== 'ready' && (
        <button type="button" onClick={() => void start()} disabled={state === 'loading'} className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 p-4 text-center text-sm text-white">
          {state === 'loading' ? <Loader2 className="h-10 w-10 animate-spin" /> : <Play className="h-12 w-12" />}
          {error && <span className="max-w-md">{error}</span>}
        </button>
      )}
      {state === 'ready' && error && <div className="absolute inset-x-0 top-0 z-20 bg-black/70 p-2 text-center text-xs text-white">{error}</div>}
      {state === 'ready' && (
        <div dir="ltr" className={`absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/80 to-transparent px-2 pb-1.5 pt-4 text-xs text-white transition-opacity ${bar ? 'opacity-100' : 'pointer-events-none opacity-0'}`}>
          <div className="flex items-center gap-2">
            <span>{clock(time)}</span>
            <input type="range" aria-label={L('Time', 'الوقت')} className="min-w-0 flex-1 accent-white" min={0} max={duration || 0} step={0.5} value={Math.min(time, duration || 0)} onChange={(e) => { if (video.current) video.current.currentTime = Number(e.target.value) }} />
            <span>{clock(duration)}</span>
          </div>
          <div className="mt-1 flex items-center gap-1.5">
            <button type="button" className={btn} aria-label={L('Back 10 seconds', 'رجوع 10 ثواني')} onClick={() => skip(-10)}><RotateCcw className="h-4 w-4" /></button>
            <button type="button" className={btn} aria-label={playing ? L('Pause', 'إيقاف') : L('Play', 'تشغيل')} onClick={toggle}>{playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}</button>
            <button type="button" className={btn} aria-label={L('Forward 10 seconds', 'تقديم 10 ثواني')} onClick={() => skip(10)}><RotateCw className="h-4 w-4" /></button>
            <button type="button" className={btn} aria-label={L('Mute', 'كتم الصوت')} onClick={() => { const v = video.current; if (v) { v.muted = !v.muted; if (!v.muted && v.volume === 0) v.volume = 1 } }}>{muted || volume === 0 ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}</button>
            {canVolume && <input type="range" aria-label={L('Volume', 'الصوت')} className="w-16 min-w-0 accent-white sm:w-24" min={0} max={1} step={0.05} value={muted ? 0 : volume} onChange={(e) => { const v = video.current; if (v) { v.volume = Number(e.target.value); v.muted = v.volume === 0 } }} />}
            <span className="flex-1" />
            <select aria-label={L('Speed', 'السرعة')} className="h-8 rounded-md border-0 bg-white/15 px-1 text-xs text-white" value={speed} onChange={(e) => { setSpeed(e.target.value); keep('tn_video_speed', e.target.value); if (video.current) video.current.playbackRate = Number(e.target.value) }}>
              {['0.5', '0.75', '1', '1.25', '1.5', '2'].map((x) => <option key={x} value={x} className="text-black">{x}x</option>)}
            </select>
            <button type="button" className={btn} aria-label={L('Full screen', 'ملء الشاشة')} onClick={() => void toggleFull()}>{full || pageFull ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}</button>
          </div>
        </div>
      )}
    </div>
  )
}
