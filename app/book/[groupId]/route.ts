/**
 * GET /book/<groupId> — six phases 1-C: a group's booking link (also behind its QR). Opens the booking of that group inside the
 * family account (sign in / make an account first). A group whose course is not on the courses page goes to the courses page.
 */

import { NextRequest, NextResponse } from 'next/server'
import { publicOrigin } from '@/lib/http/origin'
import { listingForGroup } from '@/lib/bookings/links'

export async function GET(request: NextRequest, { params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params
  const slug = await listingForGroup(groupId).catch(() => null)
  const url = new URL(slug ? `/dashboard/my-children?book=${encodeURIComponent(slug)}&group=${encodeURIComponent(groupId)}` : '/courses', publicOrigin(request.headers, request.nextUrl.origin, process.env))
  return NextResponse.redirect(url, 303)
}
