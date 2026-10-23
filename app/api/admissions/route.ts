import { campusWhere, requestPlaces } from '@/lib/places/server'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { auth } from '@/lib/auth'
import { checkPermission, CAMPUS_SCOPED_ROLES } from '@/lib/rbac'
import type { Role } from '@prisma/client'

export async function GET(req: Request) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }
    const role = session.user.role as Role
    if (!checkPermission(role, 'admissions', 'read')) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const status = searchParams.get('status')
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '10')
    const skip = (page - 1) * limit

    const where: any = {}
    if (status) {
      where.status = status
    }
    // M0: requests for the person's places only
    // 2026-10-23 (live test): online requests come in WITHOUT a branch (the public form does not ask) — they belong to
    // every front desk until someone approves them into a branch; otherwise only all-places staff ever saw them
    const placeLimit = campusWhere(await requestPlaces(session.user), 'preferredCampusId')
    if (Object.keys(placeLimit).length) where.AND = [{ OR: [placeLimit, { preferredCampusId: null }] }]

    const [requests, total] = await Promise.all([
      prisma.admissionRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.admissionRequest.count({ where })
    ])

    return NextResponse.json({
      success: true,
      data: requests,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    })
  } catch (error) {
    console.error('[ADMISSIONS_GET]', error)
    return NextResponse.json({ success: false, error: 'Failed to fetch admission requests' }, { status: 500 })
  }
}
