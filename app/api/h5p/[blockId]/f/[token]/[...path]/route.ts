/**
 * L5: GET /api/h5p/[blockId]/f/[token]/<path> — one file of an H5P package for the sandboxed player.
 * The token (signed, short-lived, made by /play for an allowed viewer) replaces cookies; files come from the private
 * package unpacked in memory (lib/h5p/package.ts). Any origin may read it (the sandboxed frame has an empty origin).
 */

import { verifyH5pToken } from '@/lib/h5p/token'
import { packageIdFor } from '@/lib/h5p/engine'
import { contentTypeOf, loadPackage, safePath } from '@/lib/h5p/package'

export const dynamic = 'force-dynamic'
const cors = { 'Access-Control-Allow-Origin': '*' }

export async function GET(_req: Request, { params }: { params: Promise<{ blockId: string; token: string; path: string[] }> }) {
  const { blockId, token, path } = await params
  if (!verifyH5pToken(token, blockId)) return new Response('Expired — open the lesson again', { status: 403, headers: cors })
  const p = safePath((path ?? []).map((x) => decodeURIComponent(x)).join('/'))
  if (!p) return new Response('Not found', { status: 404, headers: cors })
  const publicId = await packageIdFor(blockId)
  if (!publicId) return new Response('Not found', { status: 404, headers: cors })
  const pkg = await loadPackage(publicId)
  if (!pkg.ok) return new Response(pkg.message ?? 'Not available', { status: 422, headers: cors })
  const file = pkg.files!.get(p)
  if (!file) return new Response('Not found', { status: 404, headers: cors })
  return new Response(Buffer.from(file), {
    headers: { ...cors, 'Content-Type': contentTypeOf(p), 'Cache-Control': 'private, max-age=600', 'X-Content-Type-Options': 'nosniff' },
  })
}
