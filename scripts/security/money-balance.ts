/**
 * MONEY CHECK (owner 28/11): runs the shared money rules (lib/health/money-rules.ts) on any database and prints the
 * rows that break a rule. Read-only. The e2e runs it at the end; Data Health shows the same rules (S2).
 *
 *   DATABASE_URL=mysql://root@127.0.0.1:3410/technova npx tsx scripts/security/money-balance.ts
 */

import { PrismaClient } from '@prisma/client'
import { runMoneyRules } from '../../lib/health/money-rules'

const p = new PrismaClient()

async function main() {
  const results = await runMoneyRules(p)
  let problems = 0
  for (const r of results) {
    if (r.bad !== 0) problems++
    console.log(`${r.bad === 0 ? 'OK  ' : r.bad < 0 ? 'ERR ' : 'BAD '} ${r.en}${r.bad > 0 ? ` — ${r.bad} row(s)` : ''}${r.error ? ` (QUERY FAILED: ${r.error})` : ''}`)
    for (const s of r.sample) console.log('       ', JSON.stringify(s))
  }
  console.log(`\n${results.length} rules, ${problems} with problems`)
  await p.$disconnect()
}

main().catch(async (e) => { console.error(e); await p.$disconnect(); process.exit(1) })
