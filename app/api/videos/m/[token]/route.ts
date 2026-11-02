/** a02 M4 batch 3: the list of pieces for one viewing. Needs the same signed-in person and a live link. */

import { requireSession } from '@/lib/academic/api-helpers'
import { manifestFor } from '@/lib/videos/engine'
import { videoError } from '@/lib/videos/http'

export const dynamic = 'force-dynamic'

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  try {
    return new Response(await manifestFor((await params).token, session.user.id), { headers: { 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'private, no-store' } })
  } catch (e) { return videoError(e) }
}
