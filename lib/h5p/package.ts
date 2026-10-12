/**
 * L5: reads an H5P package (.h5p = zip) from private Cloudinary and serves its files one by one.
 * The zip is unpacked in memory and kept for a few minutes (small cache), so the app needs no disk — it works the same
 * on Vercel now and on our own server later. Server-only.
 */

import { unzipSync } from 'fflate'
import { curriculumMediaUrl } from '@/lib/cloudinary'

export const MAX_H5P_BYTES = 60 * 1024 * 1024
const MAX_UNPACKED = 250 * 1024 * 1024
const KEEP_MS = 10 * 60_000
const MAX_CACHED = 6

type Files = Map<string, Uint8Array>
const cache = new Map<string, { files: Files; at: number }>()

/** Safe path inside the package (no "..", no absolute paths). */
export function safePath(p: string): string | null {
  const clean = p.replace(/\\/g, '/').replace(/^\/+/, '')
  if (!clean || clean.split('/').some((s) => s === '..' || s === '.' || s === '')) return null
  return clean
}

export async function loadPackage(publicId: string): Promise<{ ok: boolean; files?: Files; message?: string }> {
  const hit = cache.get(publicId)
  if (hit && Date.now() - hit.at < KEEP_MS) { hit.at = Date.now(); return { ok: true, files: hit.files } }
  const res = await fetch(curriculumMediaUrl(publicId, 'raw'))
  if (!res.ok) return { ok: false, message: 'The activity file could not be read' }
  const buf = new Uint8Array(await res.arrayBuffer())
  if (buf.byteLength > MAX_H5P_BYTES) return { ok: false, message: 'The activity file is too big' }
  let raw: Record<string, Uint8Array>
  try { raw = unzipSync(buf) } catch { return { ok: false, message: 'This is not a valid .h5p file' } }
  const files: Files = new Map()
  let total = 0
  for (const [name, data] of Object.entries(raw)) {
    const p = safePath(name)
    if (!p || name.endsWith('/')) continue
    total += data.byteLength
    if (total > MAX_UNPACKED) return { ok: false, message: 'The activity is too big' }
    files.set(p, data)
  }
  if (!files.has('h5p.json')) return { ok: false, message: 'This is not a valid .h5p file (h5p.json missing)' }
  cache.set(publicId, { files, at: Date.now() })
  while (cache.size > MAX_CACHED) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0]
    cache.delete(oldest[0])
  }
  return { ok: true, files }
}

const TYPES: Record<string, string> = {
  json: 'application/json', js: 'text/javascript', css: 'text/css', html: 'text/html', svg: 'image/svg+xml',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', mp4: 'video/mp4', webm: 'video/webm',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', eot: 'application/vnd.ms-fontobject', otf: 'font/otf', vtt: 'text/vtt',
}
export const contentTypeOf = (p: string) => TYPES[p.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream'
