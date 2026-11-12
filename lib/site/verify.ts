/** Certificate check: what anyone may see about a certificate number (name, title, course, date, status). Server only. */

import { prisma } from '@/lib/prisma'

export interface CertificateCheck {
  certificateNumber: string; title: string; type: string; issuedDate: string; status: string
  revokedReason?: string | null; studentName: string; courseName: string | null; valid: boolean
}

export async function checkCertificate(number: string): Promise<CertificateCheck | null> {
  const c = await prisma.certificate.findUnique({
    where: { certificateNumber: number.trim().toUpperCase() },
    select: {
      certificateNumber: true, title: true, type: true, issuedDate: true, status: true, revokedReason: true,
      student: { select: { firstName: true, lastName: true, fullNameEn: true } },
      subject: { select: { name: true } },
    },
  })
  if (!c) return null
  return {
    certificateNumber: c.certificateNumber, title: c.title, type: c.type, issuedDate: c.issuedDate.toISOString(), status: c.status,
    revokedReason: c.status === 'REVOKED' ? c.revokedReason : undefined,
    studentName: c.student.fullNameEn || `${c.student.firstName} ${c.student.lastName}`,
    courseName: c.subject?.name ?? null,
    valid: c.status === 'VALID',
  }
}
