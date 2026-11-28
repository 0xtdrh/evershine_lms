/**
 * Money deep check (28/11): when two money actions touch the same rows at the same moment, MySQL may stop one of them
 * ("deadlock / write conflict", Prisma P2034). Nothing is saved by the stopped one (the whole transaction rolls back),
 * so it is safe to simply run it again. Before this, the person saw a 500 error.
 * Pure helper: wrap the WHOLE transaction (`() => prisma.$transaction(...)`), never a part of it.
 */

export const isRetryableConflict = (err: unknown) => {
  const e = err as { code?: string; message?: string } | null
  return !!e && (e.code === 'P2034' || /deadlock|write conflict|Lock wait timeout/i.test(e.message ?? ''))
}

export async function withConflictRetry<T>(run: () => Promise<T>, tries = 4): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await run()
    } catch (err) {
      if (attempt >= tries || !isRetryableConflict(err)) throw err
      await new Promise((r) => setTimeout(r, 40 * attempt + Math.floor(Math.random() * 60)))
    }
  }
}

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

/** prisma.$transaction(fn, options) that runs again (up to 4 times) when MySQL stops it for a conflict / deadlock. */
export function retryTx<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>, options?: { maxWait?: number; timeout?: number; isolationLevel?: Prisma.TransactionIsolationLevel }): Promise<T> {
  return withConflictRetry(() => prisma.$transaction(fn, options))
}
