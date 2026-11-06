/**
 * a02 M4 batch 3: protected videos. Server-only. Rules: lib/videos/rules.ts.
 * The AES key is stored sealed with VIDEO_KEY_SECRET (else NEXTAUTH_SECRET): changing that secret makes every protected video unplayable.
 */

import { signingSecret } from '@/lib/security/secret'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { prisma } from '@/lib/prisma'
import cloudinary, { generateRawPieceSignature, getBaseUploadFolder } from '@/lib/cloudinary'
import { getSetting, setSetting } from '@/lib/settings/app-settings'
import { notifyUsers } from '@/lib/notifications/events'
import { cleanVideoSettings, DEFAULT_VIDEO_SETTINGS, deviceAllowed, effectiveDeviceLimit, isSuspicious, LIVE_MS, PIECE_NAME, readManifest, TOKEN_MS, videoBlockKind, viewerManifest, type VideoSettings } from './rules'

export class VideoError extends Error {
  constructor(message: string, public status = 400, public code: string | null = null) { super(message) }
}

const KEY = 'video.settings'
export const getVideoSettings = async () => cleanVideoSettings(await getSetting<Partial<VideoSettings>>(KEY, DEFAULT_VIDEO_SETTINGS))
export async function saveVideoSettings(v: Partial<VideoSettings>, userId: string) {
  const next = cleanVideoSettings({ ...(await getVideoSettings()), ...v })
  await setSetting(KEY, next, userId)
  return next
}

// ── the key, sealed at rest ─────────────────────────────────────────────────────────────────────────────────

const sealKey = () => crypto.createHash('sha256').update(`video-key:${process.env.VIDEO_KEY_SECRET?.trim() || signingSecret()}`).digest()
export function seal(key: Buffer): string {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', sealKey(), iv)
  const out = Buffer.concat([c.update(key), c.final()])
  return [iv, c.getAuthTag(), out].map((b) => b.toString('base64')).join('.')
}
export function unseal(sealed: string): Buffer {
  const [iv, tag, out] = sealed.split('.').map((s) => Buffer.from(s, 'base64'))
  const d = crypto.createDecipheriv('aes-256-gcm', sealKey(), iv); d.setAuthTag(tag)
  return Buffer.concat([d.update(out), d.final()])
}
const hash = (token: string) => crypto.createHash('sha256').update(token).digest('hex')

// ── where the pieces live (the provider can change; `local` is for the e2e copy only) ──────────────────────

const isLocal = () => process.env.VIDEO_STORAGE === 'local'
const localDir = (id: string) => path.join(process.cwd(), '.e2e-video', id.replace(/[^\w-]/g, ''))

export function pieceUrl(v: { id: string; folder: string; provider: string }, name: string): string {
  if (v.provider === 'LOCAL') return `/api/videos/p/${v.id}/${name}`
  return cloudinary.url(`${v.folder}/${name}`, { resource_type: 'raw', type: 'upload', secure: true })
}
export function saveLocalPiece(id: string, name: string, data: Buffer) {
  if (!isLocal() || !PIECE_NAME.test(name)) throw new VideoError('Not allowed', 403)
  fs.mkdirSync(localDir(id), { recursive: true }); fs.writeFileSync(path.join(localDir(id), name), data)
}
export function readLocalPiece(id: string, name: string): Buffer | null {
  if (!isLocal() || !PIECE_NAME.test(name)) return null
  const p = path.join(localDir(id), name)
  return fs.existsSync(p) ? fs.readFileSync(p) : null
}

// ── uploading ───────────────────────────────────────────────────────────────────────────────────────────────

export async function createUpload(userId: string, originalName: string) {
  const key = crypto.randomBytes(16), iv = crypto.randomBytes(16)
  const id = crypto.randomUUID().replace(/-/g, '')
  const local = isLocal()
  const folder = local ? `local/${id}` : `${getBaseUploadFolder()}/videos/${id}`
  await prisma.protectedVideo.create({ data: { id, provider: local ? 'LOCAL' : 'CLOUDINARY', folder, keySealed: seal(key), originalName: originalName.slice(0, 200), createdById: userId } })
  return { id, key: key.toString('hex'), iv: iv.toString('hex'), mode: local ? 'local' : 'cloudinary' }
}

async function uploading(id: string) {
  const v = await prisma.protectedVideo.findUnique({ where: { id } })
  if (!v) throw new VideoError('Video not found', 404)
  if (v.status !== 'UPLOADING') throw new VideoError('This video is already finished', 409)
  return v
}

export async function signPieces(id: string) {
  const v = await uploading(id)
  if (v.provider !== 'CLOUDINARY') throw new VideoError('Not used here')
  return generateRawPieceSignature(v.folder)
}

export async function completeUpload(id: string, i: { manifest: string; sizeBytes: number }) {
  const v = await uploading(id)
  const m = readManifest(i.manifest)
  if (m.ok === false) throw new VideoError(m.reason)
  if (v.provider === 'LOCAL' && m.pieces.some((n) => !fs.existsSync(path.join(localDir(id), n)))) throw new VideoError('Some pieces did not arrive', 409, 'PIECES_MISSING')
  await prisma.protectedVideo.update({ where: { id }, data: { status: 'READY', manifest: i.manifest, pieces: m.pieces.length, durationSec: m.durationSec, sizeBytes: Math.round(i.sizeBytes) } })
  return { id, name: v.originalName, durationSec: m.durationSec, pieces: m.pieces.length }
}

// ── watching ────────────────────────────────────────────────────────────────────────────────────────────────

export interface Viewer { userId: string; studentId: string | null; groupId: string | null; device: string; ip: string | null; userAgent: string | null }

/** The block's video, or a refusal. The caller has already checked the person may open this lesson. */
export async function videoOfBlock(blockId: string) {
  const b = await prisma.curriculumBlock.findUnique({ where: { id: blockId }, select: { id: true, type: true, sessionId: true, audience: true, data: true } })
  const videoId = b?.type === 'VIDEO' ? (b.data as { protected?: { videoId?: string } })?.protected?.videoId : null
  if (!b || !videoId) throw new VideoError('Video not found', 404)
  return { block: b, videoId }
}

async function courseDevices(groupId: string | null) {
  if (!groupId) return null
  const g = await prisma.classSection.findUnique({ where: { id: groupId }, select: { kind: true, levelId: true } })
  if (g?.kind !== 'RECORDED' || !g.levelId) return null
  return (await prisma.recordedCourse.findUnique({ where: { levelId: g.levelId }, select: { videoDevices: true } }))?.videoDevices ?? null
}

/** Opens a viewing: the device limit, then a short-lived link. */
export async function openViewing(videoId: string, blockId: string, viewer: Viewer) {
  const v = await prisma.protectedVideo.findUnique({ where: { id: videoId }, select: { id: true, status: true } })
  if (!v || v.status !== 'READY') throw new VideoError('This video is not ready', 404, 'NOT_READY')
  // staff are counted by their own account, a student's family by the student
  const who = viewer.studentId ? { studentId: viewer.studentId } : { userId: viewer.userId, studentId: null }
  const live = await prisma.videoViewing.findMany({ where: { ...who, refused: false, lastSeenAt: { gte: new Date(Date.now() - LIVE_MS) } }, select: { device: true } })
  const limit = effectiveDeviceLimit(await courseDevices(viewer.groupId), (await getVideoSettings()).deviceLimit)
  const row = { videoId, blockId, userId: viewer.userId, studentId: viewer.studentId, classSectionId: viewer.groupId, device: viewer.device.slice(0, 64), ip: viewer.ip?.slice(0, 64) ?? null, userAgent: viewer.userAgent?.slice(0, 300) ?? null }
  if (!deviceAllowed(live.map((l) => l.device), viewer.device.slice(0, 64), limit)) {
    await prisma.videoViewing.create({ data: { ...row, tokenHash: hash(crypto.randomUUID()), refused: true, expiresAt: new Date() } })
    throw new VideoError(`Watching on more than ${limit} devices at once is not allowed · مسموح المشاهدة على ${limit} جهاز في نفس الوقت. اقفل الفيديو على جهاز تاني.`, 409, 'DEVICE_LIMIT')
  }
  // the same device reopening: its old link dies
  await prisma.videoViewing.updateMany({ where: { ...who, device: row.device, refused: false, expiresAt: { gt: new Date() } }, data: { expiresAt: new Date(), lastSeenAt: new Date(0) } })
  const token = crypto.randomBytes(24).toString('hex')
  await prisma.videoViewing.create({ data: { ...row, tokenHash: hash(token), expiresAt: new Date(Date.now() + TOKEN_MS) } })
  return { token, manifest: `/api/videos/m/${token}` }
}

async function viewing(token: string, userId: string) {
  const s = await prisma.videoViewing.findUnique({ where: { tokenHash: hash(token) } })
  if (!s || s.refused || s.userId !== userId || s.expiresAt <= new Date()) throw new VideoError('This viewing link has ended', 403, 'EXPIRED')
  return s
}

export async function manifestFor(token: string, userId: string) {
  const s = await viewing(token, userId)
  const v = await prisma.protectedVideo.findUnique({ where: { id: s.videoId } })
  if (!v?.manifest) throw new VideoError('Video not found', 404)
  return viewerManifest(v.manifest, `/api/videos/k/${token}`, (n) => pieceUrl(v, n))
}

/** The key. `recheck` re-reads the lesson rights, so a subscription that just ended gets nothing. */
export async function keyFor(token: string, userId: string, recheck: (s: { studentId: string | null; classSectionId: string | null; blockId: string }) => Promise<boolean>) {
  const s = await viewing(token, userId)
  if (!(await recheck(s))) throw new VideoError('You cannot open this lesson now', 403, 'LOCKED')
  const v = await prisma.protectedVideo.findUnique({ where: { id: s.videoId }, select: { keySealed: true } })
  if (!v) throw new VideoError('Video not found', 404)
  await prisma.videoViewing.update({ where: { id: s.id }, data: { keyFetches: { increment: 1 } } })
  return unseal(v.keySealed)
}

export async function heartbeat(token: string, userId: string) {
  const s = await viewing(token, userId)
  await prisma.videoViewing.update({ where: { id: s.id }, data: { lastSeenAt: new Date(), expiresAt: new Date(Date.now() + TOKEN_MS) } })
}

/** Closing the player frees the device at once. */
export async function endViewing(token: string, userId: string) {
  await prisma.videoViewing.updateMany({ where: { tokenHash: hash(token), userId }, data: { expiresAt: new Date(), lastSeenAt: new Date(0) } })
}

/** How many lesson blocks use each video. */
async function videoUses() {
  const blocks = await prisma.curriculumBlock.findMany({ where: { type: 'VIDEO' }, select: { data: true } })
  const uses = new Map<string, number>()
  for (const b of blocks) { const id = (b.data as { protected?: { videoId?: string } })?.protected?.videoId; if (id) uses.set(id, (uses.get(id) ?? 0) + 1) }
  return uses
}

/** Removes the pieces from the storage, then the row. If the storage refuses, the row stays so nothing is left behind unnoticed. */
export async function removeVideo(id: string) {
  const v = await prisma.protectedVideo.findUnique({ where: { id } })
  if (!v) throw new VideoError('Video not found', 404)
  if ((await videoUses()).get(id)) throw new VideoError('A lesson uses this video. Remove it from the lesson first · فيه درس بيستخدم الفيديو ده. شيله من الدرس الأول', 409, 'IN_USE')
  if (v.provider === 'LOCAL') fs.rmSync(localDir(id), { recursive: true, force: true })
  else {
    try {
      // a call removes up to 1000 files and says when more are left
      for (let i = 0; i < 10; i++) {
        const r = await cloudinary.api.delete_resources_by_prefix(`${v.folder}/`, { resource_type: 'raw', type: 'upload' })
        if (!r.partial) break
      }
      await cloudinary.api.delete_folder(v.folder).catch(() => null)
    } catch (e) {
      console.error('[VIDEO_REMOVE]', e)
      throw new VideoError('The storage did not remove the video. Try again · التخزين ما مسحش الفيديو، جرّب تاني', 502, 'STORAGE')
    }
  }
  await prisma.videoViewing.deleteMany({ where: { videoId: id } })
  await prisma.protectedVideo.delete({ where: { id } })
}

// ── reports ─────────────────────────────────────────────────────────────────────────────────────────────────

export async function listVideos() {
  const rows = await prisma.protectedVideo.findMany({ orderBy: { createdAt: 'desc' }, take: 200, select: { id: true, status: true, originalName: true, durationSec: true, sizeBytes: true, pieces: true, provider: true, createdAt: true } })
  const counts = await prisma.videoViewing.groupBy({ by: ['videoId'], where: { refused: false, videoId: { in: rows.map((r) => r.id) } }, _count: { _all: true } })
  const uses = await videoUses()
  return rows.map((r) => ({ ...r, viewings: counts.find((c) => c.videoId === r.id)?._count._all ?? 0, uses: uses.get(r.id) ?? 0 }))
}

/** Students to look at over the last `days` days. */
export async function suspiciousViewers(days = 7) {
  const rows = await prisma.videoViewing.findMany({ where: { startedAt: { gte: new Date(Date.now() - days * 86_400_000) }, studentId: { not: null } }, select: { studentId: true, refused: true, ip: true, device: true, keyFetches: true } })
  const by = new Map<string, { sessions: number; refused: number; ips: Set<string>; devices: Set<string>; keyFetches: number }>()
  for (const r of rows) {
    const s = by.get(r.studentId!) ?? { sessions: 0, refused: 0, ips: new Set<string>(), devices: new Set<string>(), keyFetches: 0 }
    if (r.refused) s.refused++; else s.sessions++
    if (r.ip) s.ips.add(r.ip)
    s.devices.add(r.device); s.keyFetches += r.keyFetches
    by.set(r.studentId!, s)
  }
  const flagged = [...by.entries()].map(([studentId, s]) => ({ studentId, sessions: s.sessions, refused: s.refused, ips: s.ips.size, devices: s.devices.size, keyFetches: s.keyFetches })).filter(isSuspicious)
  const names = await prisma.student.findMany({ where: { id: { in: flagged.map((f) => f.studentId) } }, select: { id: true, firstName: true, lastName: true, registrationNumber: true } })
  return flagged.map((f) => { const n = names.find((x) => x.id === f.studentId); return { ...f, name: n ? `${n.firstName} ${n.lastName}`.trim() : '—', registrationNumber: n?.registrationNumber ?? null } })
}

/** Student-visible videos without protection in a level's latest published curriculum. */
export async function unprotectedVideos(levelId: string) {
  const ed = await prisma.curriculumEdition.findFirst({ where: { levelId, status: 'PUBLISHED' }, orderBy: { number: 'desc' }, select: { id: true } })
  if (!ed) return 0
  const sessions = await prisma.curriculumSession.findMany({ where: { editionId: ed.id }, select: { id: true } })
  const blocks = await prisma.curriculumBlock.findMany({ where: { type: 'VIDEO', sessionId: { in: sessions.map((s) => s.id) }, NOT: { audience: 'INSTRUCTOR' } }, select: { data: true } })
  return blocks.filter((b) => videoBlockKind(b.data) !== 'PROTECTED').length
}

/** Daily: tell the managers who to look at, and drop old rows and unfinished uploads. */
export async function videoDailyJob() {
  const flagged = await suspiciousViewers()
  if (flagged.length) {
    const admins = await prisma.user.findMany({ where: { role: { in: ['SUPER_ADMIN', 'ADMIN'] }, isActive: true }, select: { id: true } })
    await notifyUsers(admins.map((a) => a.id), 'VIDEO_SUSPICIOUS', { title: 'Unusual video watching', message: `${flagged.length} student(s) to look at`, titleAr: 'مشاهدة فيديو غير عادية', messageAr: `عدد الطلاب اللي محتاجين مراجعة: ${flagged.length}` })
  }
  await prisma.videoViewing.deleteMany({ where: { startedAt: { lt: new Date(Date.now() - 90 * 86_400_000) } } })
  const stale = await prisma.protectedVideo.findMany({ where: { status: 'UPLOADING', createdAt: { lt: new Date(Date.now() - 7 * 86_400_000) } }, select: { id: true } })
  for (const s of stale) await removeVideo(s.id).catch((e) => console.error('[VIDEO_CLEAN]', s.id, e))
  return { flagged: flagged.length }
}
