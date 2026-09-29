import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { nextInSequence } from '@/lib/ids/sequence'

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
  // Highest number used this year + 1 (count + 1 could repeat an existing
  // number after any deletion). Format is fixed: TN-CERT-YYYY-NNNNN.
  const year = new Date().getFullYear()
  const prefix = `TN-CERT-${year}-`
  const rows = await tx.certificate.findMany({
    where: { certificateNumber: { startsWith: prefix } },
    select: { certificateNumber: true },
  })
  return nextInSequence(rows.map((r) => r.certificateNumber), prefix, 5)
}
