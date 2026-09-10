import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

/**
 * Generates a unique, human-readable certificate number, e.g. "TN-CERT-2026-00001".
 * WHY a running count per year rather than a random string: makes certificate
 * numbers predictable/sequential for administrative auditing while still being
 * effectively unguessable in combination with the QR verification flow (the
 * verification page requires the exact number, and revoked/forged numbers are
 * checked against the database, not just format-validated).
 */
export async function generateCertificateNumber(
  tx: Prisma.TransactionClient | typeof prisma = prisma
): Promise<string> {
  const year = new Date().getFullYear()
  const count = await tx.certificate.count({
    where: { certificateNumber: { startsWith: `TN-CERT-${year}-` } },
  })
  return `TN-CERT-${year}-${String(count + 1).padStart(5, '0')}`
}
