'use client'

/**
 * a02 M4 batch 3: picks a video, cuts and encrypts it in this browser (ffmpeg.wasm), sends the pieces straight to the storage, then tells the
 * server it is ready. The engine's small files are in public/vendor/ffmpeg; its large wasm comes from the CDN at an exact version, only when uploading.
 */

import { useRef, useState } from 'react'
import { fetchApi } from '@/lib/api-client'
import { L, useI18n } from '@/lib/i18n/client'
import { notify } from '@/lib/notify'
import { Button } from '@/components/ui/button'
import { MAX_FILE_GB, uploadPlan } from '@/lib/videos/rules'
import { Loader2, ShieldCheck, Upload } from 'lucide-react'

const CORE = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm'
const PARALLEL = 4
const hexBytes = (h: string) => Uint8Array.from(h.match(/../g)!.map((x) => parseInt(x, 16)))
// loaded by the browser, not by the bundler
const importBrowser = new Function('u', 'return import(u)') as (u: string) => Promise<{ FFmpeg: new () => FF }>
interface FF {
  on(e: 'log', f: (x: { message: string }) => void): void
  on(e: 'progress', f: (x: { progress: number }) => void): void
  load(o: { coreURL: string; wasmURL: string }): Promise<unknown>
  createDir(p: string): Promise<unknown>
  mount(t: string, o: { files: File[] }, p: string): Promise<unknown>
  writeFile(p: string, d: Uint8Array): Promise<unknown>
  readFile(p: string): Promise<Uint8Array | string>
  deleteFile(p: string): Promise<unknown>
  listDir(p: string): Promise<{ name: string }[]>
  exec(a: string[]): Promise<number>
  terminate(): void
}
interface Sign { timestamp: number; signature: string; apiKey: string; cloudName: string; folder: string }
export interface UploadedVideo { videoId: string; name: string; durationSec: number }

async function withRetry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  for (let i = 1; ; i++) { try { return await fn() } catch (e) { if (i >= tries) throw e; await new Promise((r) => setTimeout(r, 1000 * i)) } }
}

export function ProtectedUploader({ current, onDone }: { current?: UploadedVideo | null; onDone: (v: UploadedVideo) => void }) {
  useI18n()
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false), [step, setStep] = useState(''), [pct, setPct] = useState<number | null>(null)

  async function run(file: File) {
    if (file.size > MAX_FILE_GB * 1024 ** 3) throw new Error(L(`The file is larger than ${MAX_FILE_GB} GB. Compress it first.`, `الملف أكبر من ${MAX_FILE_GB} جيجا. اضغطه الأول.`))
    setStep(L('Preparing…', 'بيجهز…')); setPct(null)
    const { FFmpeg } = await importBrowser(`${location.origin}/vendor/ffmpeg/index.js`)
    const ff = new FFmpeg(); let log = '', started: string | null = null, finished = false
    ff.on('log', ({ message }) => { log += message + '\n' })
    ff.on('progress', ({ progress }) => { if (progress >= 0 && progress <= 1) setPct(Math.round(progress * 100)) })
    try {
      await ff.load({ coreURL: `${CORE}/ffmpeg-core.js`, wasmURL: `${CORE}/ffmpeg-core.wasm` })
      await ff.createDir('/in'); await ff.mount('WORKERFS', { files: [new File([file], 'in.mp4')] }, '/in')
      log = ''; await ff.exec(['-hide_banner', '-i', '/in/in.mp4'])
      const plan = uploadPlan(log)
      if (plan === 'NOT_A_VIDEO') throw new Error(L('This file is not a video.', 'الملف ده مش فيديو.'))
      if (plan === 'CONVERT' && !window.confirm(L('This video must be converted first. A long video can take about as long as the video itself, and this tab must stay open. Continue?', 'الفيديو ده لازم يتحوّل الأول. الفيديو الطويل ممكن ياخد وقت قريب من طوله، والصفحة لازم تفضل مفتوحة. تكمل؟'))) return
      const v = await fetchApi<{ id: string; key: string; iv: string; mode: string }>('/api/videos', { method: 'POST', body: JSON.stringify({ name: file.name }) })
      started = v.id
      await ff.writeFile('k.bin', hexBytes(v.key))
      await ff.writeFile('k.info', new TextEncoder().encode(`KEY_URI\nk.bin\n${v.iv}\n`))
      setStep(plan === 'COPY' ? L('Encrypting…', 'بيتشفر…') : L('Converting and encrypting…', 'بيتحوّل ويتشفر…')); setPct(0); log = ''
      const how = plan === 'COPY' ? ['-c', 'copy'] : ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k']
      const code = await ff.exec(['-i', '/in/in.mp4', ...how, '-f', 'hls', '-hls_time', '6', '-hls_playlist_type', 'vod', '-hls_key_info_file', 'k.info', '-hls_segment_filename', 'p%05d.ts', 'index.m3u8'])
      if (code !== 0) throw new Error(L('The video could not be processed.', 'الفيديو ما اتعالجش.'))
      await ff.deleteFile('k.bin')
      const names = (await ff.listDir('/')).map((x) => x.name).filter((n) => /^p\d{5}\.ts$/.test(n)).sort()
      const manifest = new TextDecoder().decode((await ff.readFile('index.m3u8')) as Uint8Array)
      let sign = v.mode === 'cloudinary' ? await fetchApi<Sign>(`/api/videos/${v.id}/sign`, { method: 'POST', body: '{}' }) : null
      let signedAt = Date.now(), done = 0, size = 0, next = 0
      setStep(L('Uploading…', 'بيترفع…')); setPct(0)
      const send = async (name: string, data: Uint8Array) => {
        const blob = new Blob([data as BlobPart], { type: 'video/mp2t' })
        if (v.mode === 'local') { const r = await fetch(`/api/videos/${v.id}/piece/${name}`, { method: 'PUT', body: blob }); if (!r.ok) throw new Error('piece') ; return }
        if (Date.now() - signedAt > 25 * 60_000) { sign = await fetchApi<Sign>(`/api/videos/${v.id}/sign`, { method: 'POST', body: '{}' }); signedAt = Date.now() }
        const f = new FormData()
        f.append('file', new File([blob], name)); f.append('api_key', sign!.apiKey); f.append('timestamp', String(sign!.timestamp)); f.append('signature', sign!.signature)
        f.append('folder', sign!.folder); f.append('use_filename', 'true'); f.append('unique_filename', 'false')
        const r = await fetch(`https://api.cloudinary.com/v1_1/${sign!.cloudName}/raw/upload`, { method: 'POST', body: f })
        if (!r.ok) throw new Error(`storage ${r.status}`)
      }
      // ffmpeg's files are read one at a time; only the sending runs side by side
      const worker = async () => {
        while (next < names.length) {
          const name = names[next++]
          const data = (await ff.readFile(name)) as Uint8Array
          size += data.length
          await withRetry(() => send(name, data))
          await ff.deleteFile(name)
          setPct(Math.round((++done / names.length) * 100))
        }
      }
      await Promise.all(Array.from({ length: PARALLEL }, worker))
      const out = await fetchApi<{ id: string; name: string; durationSec: number }>(`/api/videos/${v.id}/complete`, { method: 'POST', body: JSON.stringify({ manifest, sizeBytes: size }) })
      finished = true
      onDone({ videoId: out.id, name: out.name, durationSec: out.durationSec })
      notify.success(L('The video is protected and ready', 'الفيديو اتحمى وجاهز'))
    } finally {
      ff.terminate()
      // a failed upload leaves nothing behind (if this fails too, the daily job removes it after a week)
      if (started && !finished) void fetch(`/api/videos/${started}`, { method: 'DELETE' }).catch(() => null)
    }
  }

  const stay = (e: BeforeUnloadEvent) => { e.preventDefault() }
  const pick = async (file: File) => {
    setBusy(true); window.addEventListener('beforeunload', stay)
    try { await run(file) } catch (e) { notify.error((e as Error).message || L('The upload failed', 'الرفع ما نجحش')) } finally { window.removeEventListener('beforeunload', stay); setBusy(false); setStep(''); setPct(null) }
  }

  return (
    <div className="space-y-1">
      <input ref={input} type="file" accept="video/*" className="hidden" data-protected-upload onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void pick(f) }} />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="outline" className="gap-1" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} {current ? L('Replace video', 'غيّر الفيديو') : L('Upload protected video', 'ارفع فيديو محمي')}
        </Button>
        {busy && <span className="text-xs text-slate-600">{step}{pct != null ? ` ${pct}%` : ''} · {L('keep this page open', 'سيب الصفحة مفتوحة')}</span>}
        {!busy && current && <span className="flex items-center gap-1 text-xs text-emerald-700"><ShieldCheck className="h-4 w-4" /> {current.name} · {Math.floor(current.durationSec / 60)}:{String(current.durationSec % 60).padStart(2, '0')}</span>}
      </div>
    </div>
  )
}
