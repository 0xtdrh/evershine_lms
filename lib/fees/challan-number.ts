import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { isUniqueConflictOn } from '@/lib/ids/sequence'
import { takeNumber } from '@/lib/ids/counter'

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
  tx: Prisma.TransactionClient | typeof prisma = prisma,
  opts: { resync?: boolean } = {}
): Promise<string> {
  // locked counter (lib/ids/counter.ts): safe when two invoices are made at the same moment
  return takeNumber(tx, { prefix: `TN-INV-${new Date().getFullYear()}-`, pad: 5, table: 'FeeInvoice', column: 'challanNumber' }, opts)
}

/** Runs `create(number)` with a fresh invoice number, retrying on a number clash. */
export async function createWithInvoiceNumber<T>(
  create: (challanNumber: string) => Promise<T>,
  tx: Prisma.TransactionClient | typeof prisma = prisma
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const challanNumber = await generateChallanNumber(undefined, tx, { resync: attempt > 0 })
    try {
      return await create(challanNumber)
    } catch (err) {
      if (attempt < 4 && isUniqueConflictOn(err, 'challanNumber')) continue
      throw err
    }
  }
}
