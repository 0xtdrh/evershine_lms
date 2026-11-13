'use client'

/**
 * Six phases 1-D: before the first live session — try the camera and the microphone (preview + a sound bar). Nothing is
 * recorded or sent: the browser only shows what it gets, and everything stops when the window is closed.
 */

import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { L } from '@/lib/i18n/client'

export function DeviceCheck({ onClose }: { onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const [state, setState] = useState<'asking' | 'ok' | 'denied' | 'none' | 'unsupported'>('asking')
  const [cam, setCam] = useState(false)
  const [mic, setMic] = useState(false)
  const [level, setLevel] = useState(0)
  const [heard, setHeard] = useState(false)

  useEffect(() => {
    let stream: MediaStream | null = null
    let ctx: AudioContext | null = null
    let raf = 0
    const run = async () => {
      if (!navigator.mediaDevices?.getUserMedia) { setState('unsupported'); return }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      } catch (e) {
        const name = (e as { name?: string }).name
        try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }) } catch { /* no mic either */ }
        if (!stream) { setState(name === 'NotAllowedError' ? 'denied' : 'none'); return }
      }
      setCam(stream.getVideoTracks().length > 0)
      setMic(stream.getAudioTracks().length > 0)
      if (video.current && stream.getVideoTracks().length) { video.current.srcObject = stream; void video.current.play().catch(() => null) }
      if (stream.getAudioTracks().length) {
        ctx = new AudioContext()
        const an = ctx.createAnalyser()
        an.fftSize = 512
        ctx.createMediaStreamSource(stream).connect(an)
        const buf = new Uint8Array(an.fftSize)
        const tick = () => {
          an.getByteTimeDomainData(buf)
          let peak = 0
          for (const v of buf) peak = Math.max(peak, Math.abs(v - 128))
          const pct = Math.min(100, Math.round((peak / 128) * 160))
          setLevel(pct)
          if (pct > 18) setHeard(true)
          raf = requestAnimationFrame(tick)
        }
        tick()
      }
      setState('ok')
    }
    void run()
    return () => { cancelAnimationFrame(raf); stream?.getTracks().forEach((t) => t.stop()); void ctx?.close().catch(() => null) }
  }, [])

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={L('Camera and microphone test', 'تجربة الكاميرا والمايك')}>
      <div className="w-full max-w-md space-y-3 rounded-t-2xl bg-white p-4 shadow-xl sm:rounded-2xl">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900">{L('Camera and microphone test', 'تجربة الكاميرا والمايك')}</h2>
          <button type="button" onClick={onClose} aria-label={L('Close', 'اقفل')} className="rounded-lg p-1 text-slate-500 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </div>
        {state === 'asking' ? <p className="text-sm text-slate-600">{L('Allow the camera and microphone when the browser asks.', 'وافق على الكاميرا والمايك لما المتصفح يسألك.')}</p> : null}
        {state === 'denied' ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{L('The browser blocked the camera / microphone. Allow them from the lock icon next to the address, then try again.', 'المتصفح منع الكاميرا / المايك. اسمح بيهم من علامة القفل جنب العنوان وجرّب تاني.')}</p> : null}
        {state === 'none' ? <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{L('No camera or microphone was found on this device.', 'مفيش كاميرا أو مايك على الجهاز ده.')}</p> : null}
        {state === 'unsupported' ? <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{L('This browser cannot test devices. Use Chrome or Safari (updated).', 'المتصفح ده مش بيقدر يجرّب. استخدم Chrome أو Safari (محدّث).')}</p> : null}
        <video ref={video} muted playsInline className={`aspect-video w-full rounded-xl bg-slate-900 object-cover ${cam ? '' : 'hidden'}`} />
        {state === 'ok' ? (
          <ul className="space-y-2 text-sm">
            <li className={cam ? 'text-emerald-700' : 'text-amber-700'}>{cam ? `✓ ${L('The camera works', 'الكاميرا شغالة')}` : `• ${L('No camera (the student can still join with sound)', 'مفيش كاميرا (الطالب يقدر يدخل بالصوت)')}`}</li>
            <li className={mic ? (heard ? 'text-emerald-700' : 'text-slate-700') : 'text-red-700'}>
              {mic ? (heard ? `✓ ${L('The microphone hears you', 'المايك سامعك')}` : L('Say something: the bar should move', 'قول أي حاجة: الشريط لازم يتحرك')) : `✗ ${L('No microphone', 'مفيش مايك')}`}
              {mic ? <div className="mt-1 h-3 w-full overflow-hidden rounded-full bg-slate-100" aria-hidden><div className="h-full rounded-full bg-emerald-500 transition-[width]" style={{ width: `${level}%` }} /></div> : null}
            </li>
            <li className="text-slate-600">{L('Tip: a quiet place, headphones, and a charged device.', 'نصيحة: مكان هادي، وسماعة، والجهاز مشحون.')}</li>
          </ul>
        ) : null}
        <button type="button" onClick={onClose} className="w-full rounded-xl border border-slate-300 px-4 py-2 text-sm">{L('Done', 'تمام')}</button>
      </div>
    </div>
  )
}
