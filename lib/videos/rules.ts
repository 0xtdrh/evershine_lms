/**
 * a02 M4 batch 3 (2026-11-02, owner: a software solution, no subscription): protected videos, pure rules (tests/videos.test.ts).
 * A video is cut in the uploader's browser into encrypted pieces (HLS AES-128). The pieces may sit on open storage: without the key
 * they do not play. The key and the list of pieces come only from our server, after the lesson and device checks, on a short-lived
 * link tied to the signed-in person. A tool used by someone with a live session can still save it: real DRM needs a paid provider.
 */

export const LIVE_MS = 50_000 // a device counts as watching this long after its last sign of life
export const TOKEN_MS = 120_000 // a viewing link dies this long after its last sign of life
export const HEARTBEAT_MS = 20_000
export const KEY_PLACEHOLDER = 'KEY_URI'
export const MAX_FILE_GB = 1.8
export const STUDENT_DEVICE_MAX = 10

export interface VideoSettings {
  /** how many devices of one student may watch at the same time */
  deviceLimit: number
  /** a paid recorded course refuses enrolling while its curriculum has an unprotected video */
  blockUnprotectedPaid: boolean
}
export const DEFAULT_VIDEO_SETTINGS: VideoSettings = { deviceLimit: 2, blockUnprotectedPaid: true }

export function cleanVideoSettings(v: Partial<VideoSettings> | null | undefined): VideoSettings {
  const n = Math.round(Number(v?.deviceLimit))
  return {
    deviceLimit: n >= 1 && n <= STUDENT_DEVICE_MAX ? n : DEFAULT_VIDEO_SETTINGS.deviceLimit,
    blockUnprotectedPaid: typeof v?.blockUnprotectedPaid === 'boolean' ? v.blockUnprotectedPaid : DEFAULT_VIDEO_SETTINGS.blockUnprotectedPaid,
  }
}

/** The course's own number wins over the company setting. */
export const effectiveDeviceLimit = (course: number | null | undefined, setting: number) => (course && course >= 1 ? course : setting)

/** May this device start? The same device reopening never counts twice. */
export function deviceAllowed(liveDevices: string[], device: string, limit: number): boolean {
  const others = new Set(liveDevices.filter((d) => d !== device))
  return others.size < limit
}

export const PIECE_NAME = /^p\d{5}\.ts$/

const ALLOWED_TAG = /^#(EXTM3U|EXT-X-VERSION:\d+|EXT-X-TARGETDURATION:\d+|EXT-X-MEDIA-SEQUENCE:\d+|EXT-X-PLAYLIST-TYPE:VOD|EXT-X-ENDLIST|EXTINF:[\d.]+,.*)$/
const KEY_TAG = /^#EXT-X-KEY:METHOD=AES-128,URI="KEY_URI",IV=0x[0-9a-fA-F]{32}$/

/** Checks the list the uploader sends: only our tags and our piece names, every piece encrypted. */
export function readManifest(text: string): { ok: true; pieces: string[]; durationSec: number } | { ok: false; reason: string } {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  if (lines[0] !== '#EXTM3U') return { ok: false, reason: 'Not a video list' }
  const pieces: string[] = []
  let duration = 0, encrypted = false
  for (const l of lines) {
    if (l.startsWith('#EXT-X-KEY')) {
      if (!KEY_TAG.test(l)) return { ok: false, reason: 'The video is not encrypted the expected way' }
      encrypted = true
    } else if (l.startsWith('#')) {
      if (!ALLOWED_TAG.test(l)) return { ok: false, reason: `Unexpected line: ${l.slice(0, 40)}` }
      if (l.startsWith('#EXTINF:')) duration += parseFloat(l.slice(8))
    } else {
      if (!PIECE_NAME.test(l)) return { ok: false, reason: `Unexpected piece: ${l.slice(0, 40)}` }
      if (!encrypted) return { ok: false, reason: 'A piece comes before the key' }
      pieces.push(l)
    }
  }
  if (!pieces.length) return { ok: false, reason: 'The video has no pieces' }
  if (!lines.includes('#EXT-X-ENDLIST')) return { ok: false, reason: 'The video list is not finished' }
  return { ok: true, pieces, durationSec: Math.round(duration) }
}

/** The list one viewer gets: the key link is theirs, and the pieces point at the storage. */
export function viewerManifest(text: string, keyUrl: string, pieceUrl: (name: string) => string): string {
  return text.split(/\r?\n/).map((l) => {
    if (l.startsWith('#EXT-X-KEY')) return l.replace(`URI="${KEY_PLACEHOLDER}"`, `URI="${keyUrl}"`)
    return l && !l.startsWith('#') ? pieceUrl(l.trim()) : l
  }).join('\n')
}

/** From ffmpeg's description of the file: can it just be cut, or must it be converted first (slow)? */
export function uploadPlan(ffmpegLog: string): 'COPY' | 'CONVERT' | 'NOT_A_VIDEO' {
  const video = ffmpegLog.match(/Stream #\S+.*?: Video: (\w+)[^\n]*/)
  if (!video) return 'NOT_A_VIDEO'
  const audio = ffmpegLog.match(/Stream #\S+.*?: Audio: (\w+)/)
  const okVideo = video[1] === 'h264' && /yuv420p(?!\d)/.test(video[0])
  const okAudio = !audio || ['aac', 'mp3'].includes(audio[1])
  return okVideo && okAudio ? 'COPY' : 'CONVERT'
}

/** Which kind of video a block holds. */
export function videoBlockKind(data: unknown): 'PROTECTED' | 'OLD_FILE' | 'LINK' | 'NONE' {
  const d = (data ?? {}) as { protected?: { videoId?: string }; media?: { publicId?: string }; url?: string }
  if (d.protected?.videoId) return 'PROTECTED'
  if (d.media?.publicId) return 'OLD_FILE'
  return d.url ? 'LINK' : 'NONE'
}

/** Worth a look? Many refused devices, many networks, or far more key requests than viewings. */
export function isSuspicious(s: { sessions: number; refused: number; ips: number; keyFetches: number }): boolean {
  return s.refused >= 5 || s.ips >= 6 || s.keyFetches >= s.sessions * 5 + 20
}

/** Where the picture really is inside the player box, so the name never sits on the black bars. */
export function pictureRect(boxW: number, boxH: number, videoW: number, videoH: number) {
  if (!boxW || !boxH || !videoW || !videoH) return { left: 0, top: 0, width: boxW, height: boxH }
  const scale = Math.min(boxW / videoW, boxH / videoH)
  const width = videoW * scale, height = videoH * scale
  return { left: (boxW - width) / 2, top: (boxH - height) / 2, width, height }
}
