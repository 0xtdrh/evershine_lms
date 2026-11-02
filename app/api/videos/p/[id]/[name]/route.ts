/** a02 M4 batch 3: one encrypted piece from the local store (e2e copy only). Open on purpose, like the real storage: a piece is useless without the key. */

import { errors } from '@/lib/api-response'
import { readLocalPiece } from '@/lib/videos/engine'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; name: string }> }) {
  const { id, name } = await params
  const data = readLocalPiece(id, name)
  if (!data) return errors.notFound('Piece')
  return new Response(new Uint8Array(data), { headers: { 'Content-Type': 'video/mp2t', 'Cache-Control': 'public, max-age=3600' } })
}
