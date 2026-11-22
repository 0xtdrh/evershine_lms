/**
 * Old website sign-up steps (six phases 1-a) — removed 2026-11-13: families now sign up first (/signup) and book from
 * their account. Old shared links go to the course page, whose button books inside the account. (/join/p/<code> = partner links, kept.)
 */

import { NextRequest, NextResponse } from 'next/server'
import { publicOrigin } from '@/lib/http/origin'

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  // final test B11: request.url carries the address the server listens on (0.0.0.0 locally / behind a proxy) — use the public one
  return NextResponse.redirect(new URL(`/courses/${encodeURIComponent(slug)}`, publicOrigin(request.headers, request.nextUrl.origin, process.env)), 308)
}
