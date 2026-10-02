import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { isUniqueConflictOn, nextInSequence } from '@/lib/ids/sequence'

/**
 * Invoice numbers: TN-INV-YYYY-NNNNN (numbering restarts each year), e.g.
 * TN-INV-2026-00001. Stored in FeeInvoice.challanNumber.
 *
 * WHY: there used to be three formats (ESA/YY-YY/NNNNN from the template,
 * CHL/<student>/<year>/<month>, ...), and the ESA one printed "ESA/00-00/..."
 * once the academic year was hidden. Highest number + 1 (never count + 1);
 * callers create the invoice through createWithInvoiceNumber, which retries if
 * two invoices are created at the same moment.
 *
 * The argument is ignored (kept so older call sites keep compiling).
 */
export async function generateChallanNumber(
  _academicYear?: string,
  tx: Prisma.TransactionClient | typeof prisma = prisma
): Promise<string> {
  const prefix = `TN-INV-${new Date().getFullYear()}-`
  const rows = await tx.feeInvoice.findMany({
    where: { challanNumber: { startsWith: prefix } },
    select: { challanNumber: true },
  })
  return nextInSequence(rows.map((r) => r.challanNumber), prefix, 5)
}

/** Runs `create(number)` with a fresh invoice number, retrying on a number clash. */
export async function createWithInvoiceNumber<T>(
  create: (challanNumber: string) => Promise<T>,
  tx: Prisma.TransactionClient | typeof prisma = prisma
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const challanNumber = await generateChallanNumber(undefined, tx)
    try {
      return await create(challanNumber)
    } catch (err) {
      if (attempt < 4 && isUniqueConflictOn(err, 'challanNumber')) continue
      throw err
    }
  }
}
