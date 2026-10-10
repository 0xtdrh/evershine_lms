/**
 * LMS L3 batch 2 — reads a student's tool project for the automatic checks (server-only).
 * Public APIs only (no student passwords): Scratch project API, MakeCode share API, Snap! cloud API, GitHub REST
 * (optional GITHUB_TOKEN raises the hourly limit). Uploaded .sb3 / .aia / .ino / .xml files are read from our private
 * Cloudinary storage. Every request has a timeout and a size limit; a failure never breaks the hand-in — the check
 * then waits for the instructor.
 */

import { unzipSync, strFromU8 } from 'fflate'
import { curriculumMediaUrl } from '@/lib/cloudinary'
import { analyzeAppInventor, analyzeArduino, analyzeMakecode, analyzeScratch, analyzeSnap, evaluateRules, parseToolLink, type Facts, type ToolCheck, type RuleResult } from './tool-checks'

const LIMIT = 15 * 1024 * 1024

async function get(url: string, opts: { headers?: Record<string, string>; asBytes?: boolean } = {}): Promise<{ ok: boolean; status: number; text?: string; bytes?: Uint8Array; headers?: Headers }> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 10_000)
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'TechNova-LMS', ...(opts.headers ?? {}) }, signal: ctrl.signal, cache: 'no-store' })
    const len = Number(res.headers.get('content-length') ?? 0)
    if (len > LIMIT) return { ok: false, status: 413 }
    const buf = new Uint8Array(await res.arrayBuffer())
    if (buf.byteLength > LIMIT) return { ok: false, status: 413 }
    return { ok: res.ok, status: res.status, headers: res.headers, ...(opts.asBytes ? { bytes: buf } : { text: new TextDecoder().decode(buf) }) }
  } catch {
    return { ok: false, status: 0 }
  } finally {
    clearTimeout(t)
  }
}

async function scratchFacts(id: string): Promise<Facts | string> {
  const meta = await get(`https://api.scratch.mit.edu/projects/${id}`)
  if (!meta.ok) return 'The Scratch project is not shared (click "Share" on Scratch) or the link is wrong'
  const token = (JSON.parse(meta.text!) as { project_token?: string }).project_token
  const proj = await get(`https://projects.scratch.mit.edu/${id}${token ? `?token=${token}` : ''}`)
  if (!proj.ok) return 'Could not read the Scratch project'
  return analyzeScratch(JSON.parse(proj.text!))
}

async function makecodeFacts(id: string): Promise<Facts | string> {
  const r = await get(`https://makecode.com/api/${id}/text`)
  if (!r.ok) return 'The MakeCode project is not shared or the link is wrong'
  const files = JSON.parse(r.text!) as Record<string, string>
  return analyzeMakecode(Object.entries(files).filter(([n]) => n.endsWith('.ts') || n.endsWith('.py')).map(([, v]) => v).join('\n'))
}

async function snapFacts(owner: string, name: string): Promise<Facts | string> {
  const r = await get(`https://snap.berkeley.edu/api/v1/projects/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`)
  if (!r.ok) return 'The Snap! project is not public or the link is wrong'
  return analyzeSnap(r.text!)
}

async function githubFacts(owner: string, repo: string): Promise<Facts | string> {
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json', ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) }
  const meta = await get(`https://api.github.com/repos/${owner}/${repo}`, { headers })
  if (!meta.ok) return meta.status === 403 ? 'GitHub is busy, the instructor will check it' : 'The GitHub repository is private or the link is wrong'
  const branch = (JSON.parse(meta.text!) as { default_branch?: string }).default_branch ?? 'main'
  const tree = await get(`https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`, { headers })
  const files = tree.ok ? ((JSON.parse(tree.text!) as { tree?: { path: string; type: string }[] }).tree ?? []).filter((x) => x.type === 'blob').map((x) => x.path) : []
  const commits = await get(`https://api.github.com/repos/${owner}/${repo}/commits?per_page=1`, { headers })
  let count = 0
  if (commits.ok) {
    const last = commits.headers?.get('link')?.match(/[?&]page=(\d+)>;\s*rel="last"/)
    count = last ? Number(last[1]) : (JSON.parse(commits.text!) as unknown[]).length
  }
  return { names: new Set(), files, commits: count, hasReadme: files.some((f) => /^readme(\.|$)/i.test(f.split('/').pop() ?? '')) }
}

type StoredFile = { publicId: string; resourceType: 'image' | 'video' | 'raw'; format?: string; originalName?: string }

async function fileFacts(tool: string, f: StoredFile): Promise<Facts | string | null> {
  const name = (f.originalName ?? f.publicId).toLowerCase()
  const want = tool === 'SCRATCH' ? '.sb3' : tool === 'APPINVENTOR' ? '.aia' : tool === 'ARDUINO' ? '.ino' : tool === 'SNAP' ? '.xml' : null
  if (!want || !name.endsWith(want)) return null
  const r = await get(curriculumMediaUrl(f.publicId, f.resourceType, f.resourceType === 'raw' ? undefined : f.format), { asBytes: true })
  if (!r.ok || !r.bytes) return 'Could not read the uploaded file'
  try {
    if (want === '.ino') return analyzeArduino(strFromU8(r.bytes))
    if (want === '.xml') return analyzeSnap(strFromU8(r.bytes))
    const zip = unzipSync(r.bytes, { filter: (e) => e.originalSize < LIMIT && (/project\.json$|\.scm$|\.bky$/.test(e.name)) })
    if (want === '.sb3') {
      const pj = Object.entries(zip).find(([n]) => n.endsWith('project.json'))
      return pj ? analyzeScratch(JSON.parse(strFromU8(pj[1]))) : 'This .sb3 file has no project inside'
    }
    return analyzeAppInventor(Object.fromEntries(Object.entries(zip).map(([n, b]) => [n, strFromU8(b)])))
  } catch {
    return 'The uploaded file is damaged'
  }
}

export interface ToolCheckResult { ok: boolean; score: number; max: number; detail: RuleResult[]; error?: string; source?: string }

/** Runs the author's rules on the student's link / file / editor code. */
export async function runToolCheck(check: ToolCheck, input: { links?: string[]; files?: StoredFile[]; code?: string | null }): Promise<ToolCheckResult> {
  const max = check.rules.reduce((s, r) => s + r.points, 0)
  const fail = (error: string): ToolCheckResult => ({ ok: false, score: 0, max, detail: check.rules.map((r) => ({ id: r.id, kind: r.kind, ok: false, points: 0, max: r.points })), error })
  let facts: Facts | string | null = null
  let source = ''
  if (check.tool === 'ARDUINO' && input.code?.trim()) { facts = analyzeArduino(input.code); source = 'editor' }
  for (const f of input.files ?? []) {
    if (facts) break
    facts = await fileFacts(check.tool, f)
    if (facts) source = f.originalName ?? 'file'
  }
  for (const l of input.links ?? []) {
    if (facts) break
    const p = parseToolLink(l)
    if (!p || p.tool !== check.tool) continue
    source = l
    facts = p.tool === 'SCRATCH' ? await scratchFacts(p.id)
      : p.tool === 'MAKECODE' ? await makecodeFacts(p.id)
        : p.tool === 'SNAP' ? await snapFacts(p.owner!, p.id)
          : p.tool === 'GITHUB' ? await githubFacts(p.owner!, p.id) : null
  }
  if (!facts) return fail(`No ${check.tool.toLowerCase()} project found in the hand-in`)
  if (typeof facts === 'string') return { ...fail(facts), source }
  return { ok: true, ...evaluateRules(check, facts), source }
}
