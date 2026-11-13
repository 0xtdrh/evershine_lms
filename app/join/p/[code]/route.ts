/**
 * GET /join/p/<code> — six phases 1-C: a partner's sign-up link (also behind its QR). A good code opens the sign-up page with
 * the partner filled in; a wrong / stopped code opens the normal sign-up.
 */

import { NextRequest, NextResponse } from 'next/server'
import { partnerByJoinCode } from '@/lib/partners/join'

export async function GET(request: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const p = await partnerByJoinCode(code).catch(() => null)
  const url = new URL(p ? `/signup?partner=${encodeURIComponent(code.toUpperCase())}` : '/signup', request.nextUrl.origin)
  return NextResponse.redirect(url, 303)
}
