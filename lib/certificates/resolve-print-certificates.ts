import { prisma } from '@/lib/prisma'
import type { PrintCertificate, PrintFieldLayout } from './pdf-renderer'

export interface ResolvedPrintCertificate extends PrintCertificate {
  studentNameAr: string | null
}

/**
 * Resolves a list of certificate IDs into full render payloads: student
 * name, course name, and the template (background + field layout) to draw
 * on. Shared by POST /api/certificates/print (new export) and
 * /api/certificates/print/[id] (viewing/editing an existing batch).
 *
 * WHY the default-template fallback: `Certificate.templateId` is captured
 * once, at issuance time. Certificates issued before any CertificateTemplate
 * existed have `templateId: null` forever — uploading a template afterward
 * doesn't retroactively attach it. Falling back to whichever template is
 * currently marked `isDefault` lets those certificates render anyway,
 * instead of being silently skipped by buildCertificatesPdf.
 */
export async function resolvePrintCertificates(
  certificateIds: string[]
): Promise<ResolvedPrintCertificate[]> {
  if (certificateIds.length === 0) return []

  const [certificates, defaultTemplate] = await Promise.all([
    prisma.certificate.findMany({
      where: { id: { in: certificateIds }, status: 'VALID' },
      include: {
        student: { select: { id: true, firstName: true, lastName: true, fullNameEn: true, fullNameAr: true } },
        subject: { select: { id: true, name: true } },
        template: { select: { backgroundUrl: true, fieldLayout: true, widthPx: true, heightPx: true } },
      },
    }),
    prisma.certificateTemplate.findFirst({ where: { isDefault: true } }),
  ])

  // Order by course name, then by certificate number (chronological within a
  // course, so levels naturally come out in the order they were earned).
  const ordered = [...certificates].sort((a, b) => {
    const courseCompare = (a.subject?.name ?? '').localeCompare(b.subject?.name ?? '')
    if (courseCompare !== 0) return courseCompare
    return a.certificateNumber.localeCompare(b.certificateNumber)
  })

  return ordered.map((c) => {
    const template = c.template ?? defaultTemplate

    return {
      id: c.id,
      certificateNumber: c.certificateNumber,
      title: c.title,
      issuedDate: c.issuedDate.toISOString(),
      qrCodeUrl: c.qrCodeUrl,
      studentName: c.student.fullNameEn || `${c.student.firstName} ${c.student.lastName}`,
      studentNameAr: c.student.fullNameAr,
      courseName: c.subject?.name ?? '',
      template: template
        ? {
            backgroundUrl: template.backgroundUrl,
            fieldLayout: template.fieldLayout as unknown as PrintFieldLayout[],
            widthPx: template.widthPx,
            heightPx: template.heightPx,
          }
        : null,
    }
  })
}
