/**
 * Old website sign-up steps (six phases 1-a) — removed 2026-11-13: families now sign up first (/signup) and book from
 * their account. Old shared links go to the course page, whose button books inside the account. (/join/p/<code> = partner links, kept.)
 */

import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  return NextResponse.redirect(new URL(`/courses/${encodeURIComponent(slug)}`, request.url), 308)
}
