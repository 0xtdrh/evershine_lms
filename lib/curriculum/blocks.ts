/**
 * LMS L1 — pure rules for curriculum content blocks (docs/plan-learning-platform.md §2). No DB here (tested).
 * Each block type has its own `data` shape, validated with zod. Embeds are limited to an allow-list of sites
 * (anything else is refused, so nobody can put a random web page inside the lesson).
 */

import { z } from 'zod'
import { assignmentDataSchema } from '@/lib/assignments/rules'

export const BLOCK_TYPES = ['TEXT', 'IMAGE', 'VIDEO', 'FILE', 'LINK', 'CODE', 'EMBED', 'H5P', 'QUIZ', 'ASSIGNMENT', 'TOOL'] as const
export type BlockType = (typeof BLOCK_TYPES)[number]
/** Types that are built in later stages (L2 / L4): they can be added as placeholders only. */
export const COMING_TYPES: BlockType[] = ['H5P', 'QUIZ', 'TOOL']
export const AUDIENCES = ['BOTH', 'INSTRUCTOR', 'STUDENT'] as const
export type Audience = (typeof AUDIENCES)[number]
export const EDITION_STATUSES = ['DRAFT', 'IN_REVIEW', 'PUBLISHED', 'ARCHIVED'] as const
export type EditionStatus = (typeof EDITION_STATUSES)[number]

/** Sites that may be embedded (host or a sub-domain of it). */
export const EMBED_HOSTS = [
  'youtube.com', 'youtube-nocookie.com', 'youtu.be', 'vimeo.com', 'player.vimeo.com',
  'scratch.mit.edu', 'tinkercad.com', 'wokwi.com', 'makecode.microbit.org', 'makecode.com', 'arcade.makecode.com',
  'code.org', 'studio.code.org', 'docs.google.com', 'drive.google.com', 'h5p.org', 'canva.com', 'genially.com',
  'replit.com', 'trinket.io', 'codepen.io', 'geogebra.org', 'phet.colorado.edu',
]

export function hostAllowed(url: string, hosts = EMBED_HOSTS): boolean {
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:') return false
    const h = u.hostname.toLowerCase().replace(/^www\./, '')
    return hosts.some((a) => h === a || h.endsWith(`.${a}`))
  } catch {
    return false
  }
}

/** Turns a YouTube / Vimeo page link into its embed link (null = not a known video link). */
export function videoEmbedUrl(url: string): string | null {
  try {
    const u = new URL(url)
    const h = u.hostname.replace(/^www\./, '').replace(/^m\./, '')
    let id: string | null = null
    if (h === 'youtu.be') id = u.pathname.slice(1).split('/')[0]
    else if (h === 'youtube.com' || h === 'youtube-nocookie.com') {
      if (u.pathname === '/watch') id = u.searchParams.get('v')
      else { const m = u.pathname.match(/^\/(?:embed|shorts|live)\/([^/?]+)/); id = m?.[1] ?? null }
    }
    if (id && /^[\w-]{6,20}$/.test(id)) return `https://www.youtube-nocookie.com/embed/${id}?rel=0&modestbranding=1`
    if (h === 'vimeo.com' || h === 'player.vimeo.com') {
      const m = u.pathname.match(/(\d{5,12})/)
      if (m) return `https://player.vimeo.com/video/${m[1]}`
    }
    return null
  } catch {
    return null
  }
}

const media = z.object({ publicId: z.string().min(1).max(300), resourceType: z.enum(['image', 'video', 'raw']), format: z.string().max(10).optional(), bytes: z.number().optional(), originalName: z.string().max(200).optional() })
const httpsUrl = z.string().trim().url().max(1000).refine((u) => u.startsWith('https://'), 'Link must start with https://')

export const blockDataSchemas: Record<BlockType, z.ZodTypeAny> = {
  TEXT: z.object({ textEn: z.string().max(50000).default(''), textAr: z.string().max(50000).default('') }),
  IMAGE: z.object({ media, captionEn: z.string().max(300).optional(), captionAr: z.string().max(300).optional() }),
  VIDEO: z.object({ media: media.optional(), url: httpsUrl.optional() })
    .refine((d) => !!d.media || (!!d.url && !!videoEmbedUrl(d.url)), 'Upload a video or paste a YouTube / Vimeo link'),
  FILE: z.object({ media, downloadable: z.boolean().default(false) }),
  LINK: z.object({ url: httpsUrl }),
  CODE: z.object({ language: z.string().max(20).default('text'), code: z.string().max(20000) }),
  EMBED: z.object({ url: httpsUrl.refine((u) => hostAllowed(u), 'This site is not in the allowed list'), height: z.number().int().min(200).max(1200).default(480) }),
  H5P: z.object({ note: z.string().max(500).optional() }).passthrough(),
  QUIZ: z.object({ note: z.string().max(500).optional() }).passthrough(),
  ASSIGNMENT: assignmentDataSchema,
  TOOL: z.object({ note: z.string().max(500).optional() }).passthrough(),
}

export interface BlockCheck { ok: boolean; data?: unknown; message?: string }

export function validateBlockData(type: string, data: unknown): BlockCheck {
  if (!(BLOCK_TYPES as readonly string[]).includes(type)) return { ok: false, message: 'Unknown content type' }
  const r = blockDataSchemas[type as BlockType].safeParse(data ?? {})
  if (!r.success) return { ok: false, message: r.error.issues[0]?.message ?? 'Invalid content' }
  return { ok: true, data: r.data }
}

/** Students (and parents) never see instructor-only blocks. */
export const visibleTo = (audience: string, viewer: 'INSTRUCTOR' | 'STUDENT') => viewer === 'INSTRUCTOR' || audience !== 'INSTRUCTOR'

/** Status machine of an edition. Returns the new status or null when the move is not allowed. */
export type EditionAction = 'submit' | 'reject' | 'publish' | 'archive'
export function nextStatus(current: string, action: EditionAction, canApprove: boolean): EditionStatus | null {
  if (action === 'submit') return current === 'DRAFT' ? 'IN_REVIEW' : null
  if (action === 'reject') return current === 'IN_REVIEW' && canApprove ? 'DRAFT' : null
  if (action === 'publish') return (current === 'IN_REVIEW' || current === 'DRAFT') && canApprove ? 'PUBLISHED' : null
  if (action === 'archive') return current === 'PUBLISHED' && canApprove ? 'ARCHIVED' : null
  return null
}

/** New order after moving one item up / down (ids in their current order). */
export function moveInOrder(ids: string[], id: string, dir: 'up' | 'down'): string[] {
  const i = ids.indexOf(id)
  const j = dir === 'up' ? i - 1 : i + 1
  if (i < 0 || j < 0 || j >= ids.length) return ids
  const out = [...ids]
  ;[out[i], out[j]] = [out[j], out[i]]
  return out
}

/** Files a curriculum author may upload (no SVG / HTML: they can carry scripts). */
export const CURRICULUM_UPLOAD_FORMATS = 'jpg,jpeg,png,webp,gif,pdf,mp4,webm,mov,mp3,wav,pptx,docx,xlsx,zip,ino,py,sb3,stl'
