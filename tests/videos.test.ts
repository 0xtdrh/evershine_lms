import { describe, expect, it } from 'vitest'
import { cleanVideoSettings, deviceAllowed, effectiveDeviceLimit, isSuspicious, pictureRect, readManifest, uploadPlan, videoBlockKind, viewerManifest } from '@/lib/videos/rules'

const IV = '0x' + 'ab'.repeat(16)
const list = (extra = '') => `#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:6\n#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-PLAYLIST-TYPE:VOD\n#EXT-X-KEY:METHOD=AES-128,URI="KEY_URI",IV=${IV}\n#EXTINF:6.000000,\np00000.ts\n#EXTINF:3.500000,\np00001.ts\n${extra}#EXT-X-ENDLIST\n`

describe('the list of pieces', () => {
  it('accepts a finished encrypted list and adds up the time', () => {
    expect(readManifest(list())).toEqual({ ok: true, pieces: ['p00000.ts', 'p00001.ts'], durationSec: 10 })
  })
  it('refuses a list without encryption', () => {
    expect(readManifest(list().replace(/#EXT-X-KEY[^\n]*\n/, '')).ok).toBe(false)
  })
  it('refuses a key that points anywhere else', () => {
    expect(readManifest(list().replace('KEY_URI', 'https://evil.example.com/k')).ok).toBe(false)
  })
  it('refuses pieces from elsewhere', () => {
    expect(readManifest(list().replace('p00001.ts', 'https://evil.example.com/x.ts')).ok).toBe(false)
    expect(readManifest(list().replace('p00001.ts', '../../secret.ts')).ok).toBe(false)
  })
  it('refuses an unfinished list and unknown tags', () => {
    expect(readManifest(list().replace('#EXT-X-ENDLIST\n', '')).ok).toBe(false)
    expect(readManifest(list('#EXT-X-MAP:URI="x"\n')).ok).toBe(false)
  })
  it('gives each viewer a key link and the storage links', () => {
    const out = viewerManifest(list(), '/api/videos/k/abc', (n) => `https://cdn/${n}`)
    expect(out).toContain('URI="/api/videos/k/abc"')
    expect(out).toContain('https://cdn/p00001.ts')
    expect(out).not.toContain('KEY_URI')
    expect(out).toContain('#EXTINF:3.500000,')
  })
})

describe('devices at the same time', () => {
  it('counts other devices only', () => {
    expect(deviceAllowed(['a', 'b'], 'c', 2)).toBe(false)
    expect(deviceAllowed(['a', 'b'], 'a', 2)).toBe(true)
    expect(deviceAllowed(['a', 'a'], 'b', 2)).toBe(true)
    expect(deviceAllowed([], 'a', 1)).toBe(true)
  })
  it('the course number wins over the setting', () => {
    expect(effectiveDeviceLimit(3, 2)).toBe(3)
    expect(effectiveDeviceLimit(null, 2)).toBe(2)
    expect(effectiveDeviceLimit(0, 2)).toBe(2)
  })
  it('cleans the settings', () => {
    expect(cleanVideoSettings({ deviceLimit: 0 }).deviceLimit).toBe(2)
    expect(cleanVideoSettings({ deviceLimit: 99 }).deviceLimit).toBe(2)
    expect(cleanVideoSettings({ deviceLimit: 4, blockUnprotectedPaid: false })).toEqual({ deviceLimit: 4, blockUnprotectedPaid: false })
    expect(cleanVideoSettings(null).blockUnprotectedPaid).toBe(true)
  })
})

describe('uploading', () => {
  it('a normal mp4 is only cut', () => {
    expect(uploadPlan('  Stream #0:0[0x1](und): Video: h264 (High) (avc1), yuv420p(tv), 1280x720\n  Stream #0:1: Audio: aac (LC), 44100 Hz')).toBe('COPY')
    expect(uploadPlan('Stream #0:0: Video: h264 (Main), yuv420p')).toBe('COPY')
  })
  it('other formats must be converted', () => {
    expect(uploadPlan('Stream #0:0: Video: hevc (Main), yuv420p\nStream #0:1: Audio: aac')).toBe('CONVERT')
    expect(uploadPlan('Stream #0:0: Video: h264 (High 10), yuv420p10le')).toBe('CONVERT')
    expect(uploadPlan('Stream #0:0: Video: h264 (High), yuv420p\nStream #0:1: Audio: opus')).toBe('CONVERT')
  })
  it('a file with no picture is refused', () => {
    expect(uploadPlan('Stream #0:0: Audio: aac')).toBe('NOT_A_VIDEO')
  })
})

describe('what a block holds', () => {
  it('tells them apart', () => {
    expect(videoBlockKind({ protected: { videoId: 'x' } })).toBe('PROTECTED')
    expect(videoBlockKind({ media: { publicId: 'x' } })).toBe('OLD_FILE')
    expect(videoBlockKind({ url: 'https://youtu.be/x' })).toBe('LINK')
    expect(videoBlockKind({})).toBe('NONE')
  })
})

describe('unusual watching', () => {
  const base = { sessions: 3, refused: 0, ips: 1, keyFetches: 3 }
  it('normal use is quiet', () => expect(isSuspicious(base)).toBe(false))
  it('many refusals, networks or keys are flagged', () => {
    expect(isSuspicious({ ...base, refused: 5 })).toBe(true)
    expect(isSuspicious({ ...base, ips: 6 })).toBe(true)
    expect(isSuspicious({ ...base, keyFetches: 35 })).toBe(true)
  })
})

describe('where the picture is', () => {
  it('wide video in a tall phone: bars above and below', () => {
    expect(pictureRect(400, 800, 1280, 720)).toEqual({ left: 0, top: 287.5, width: 400, height: 225 })
  })
  it('tall video in a wide box: bars on the sides', () => {
    expect(pictureRect(800, 400, 720, 1280)).toEqual({ left: 287.5, top: 0, width: 225, height: 400 })
  })
  it('before the video loads it uses the box', () => {
    expect(pictureRect(400, 300, 0, 0)).toEqual({ left: 0, top: 0, width: 400, height: 300 })
  })
})
