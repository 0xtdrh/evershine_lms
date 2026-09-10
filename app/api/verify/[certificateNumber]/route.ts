import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

/**
 * GET /api/verify/[certificateNumber]
 *
 * Public, unauthenticated endpoint — anyone who scans a certificate's QR
 * code or types in its number can confirm it is a genuine TechNova
 * certificate. WHY no auth: verification only works if a third party
 * (employer, another school) with no TechNova account can check it.
 *
 * Only non-sensitive fields are returned — never phone numbers, addresses,
 * financial data, or any other student PII beyond the display name.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ certificateNumber: string }> }
) {
  const { certificateNumber } = await params

  const certificate = await prisma.certificate.findUnique({
    where: { certificateNumber },
    select: {
      certificateNumber: true,
      title: true,
      type: true,
      issuedDate: true,
      status: true,
      revokedAt: true,
      revokedReason: true,
      isRevealed: true,
      student: {
        select: { firstName: true, lastName: true, fullNameEn: true },
      },
      subject: {
        select: { name: true },
      },
    },
  })

  if (!certificate) {
    return NextResponse.json(
      { success: false, valid: false, error: 'No certificate found with this number.' },
      { status: 404 }
    )
  }

  return NextResponse.json({
    success: true,
    valid: certificate.status === 'VALID',
    data: {
      certificateNumber: certificate.certificateNumber,
      title: certificate.title,
      type: certificate.type,
      issuedDate: certificate.issuedDate,
      status: certificate.status,
      revokedReason: certificate.status === 'REVOKED' ? certificate.revokedReason : undefined,
      studentName: certificate.student.fullNameEn || `${certificate.student.firstName} ${certificate.student.lastName}`,
      courseName: certificate.subject?.name ?? null,
      // WHY: don't leak that a certificate exists but is still awaiting the
      // reveal ceremony — treat it the same as "found and valid", since the
      // certificate's authenticity is confirmed regardless of ceremony timing.
    },
  })
}
