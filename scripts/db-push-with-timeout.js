#!/usr/bin/env node
/**
 * Runs `prisma db push --skip-generate` with a time limit.
 *
 * SECURITY BATCH (2026-11-06): no --accept-data-loss any more. A schema change that would drop or lose data now STOPS the
 * build and the live version stays; the change is then done by hand after a backup. Set DB_PUSH_ALLOW_DATA_LOSS=1 on the host
 * for one build only when the loss is intended.
 *
 * 2026-11-06: if the database cannot be reached at all (Prisma P1001, e.g. the host powered it off), the build goes on WITHOUT
 * the schema push, so a security fix in the code can still go live. The schema is pushed by the next build that reaches it.
 * A refused change (data loss) still stops the build.
 *
 * WHY the time limit: on 2026-09-29 a Vercel build hung for 46 minutes (Vercel's 45-minute
 * limit) with no schema change at all, most likely waiting on the Railway
 * database connection. A hang must fail fast and retry, not burn the whole build.
 *
 * Each attempt gets DB_PUSH_TIMEOUT_MS (default 5 min); 2 attempts in total.
 * If both fail the build fails, and the currently live version stays live.
 */

'use strict'

const { spawn } = require('child_process')

const TIMEOUT_MS = Number(process.env.DB_PUSH_TIMEOUT_MS) || 5 * 60 * 1000
const ATTEMPTS = 2
const UNREACHABLE = /P1001|Can't reach database server/

function attempt(n) {
  return new Promise((resolve) => {
    console.log(`[db-push] attempt ${n}/${ATTEMPTS} (limit ${Math.round(TIMEOUT_MS / 1000)}s)`)
    // Run the Prisma CLI directly with node (no npx / shell), so the kill
    // below stops the real process.
    const cli = require.resolve('prisma/build/index.js')
    const args = ['db', 'push', '--skip-generate', ...(process.env.DB_PUSH_ALLOW_DATA_LOSS === '1' ? ['--accept-data-loss'] : [])]
    const child = spawn(process.execPath, [cli, ...args], { stdio: ['inherit', 'pipe', 'pipe'] })
    let out = ''
    const keep = (stream, chunk) => { out += chunk; stream.write(chunk) }
    child.stdout.on('data', (c) => keep(process.stdout, c))
    child.stderr.on('data', (c) => keep(process.stderr, c))
    const timer = setTimeout(() => {
      console.error(`[db-push] attempt ${n} timed out, stopping it`)
      child.kill('SIGKILL')
    }, TIMEOUT_MS)
    child.on('exit', (code) => {
      clearTimeout(timer)
      resolve({ ok: code === 0, unreachable: UNREACHABLE.test(out) })
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      console.error('[db-push]', err.message)
      resolve({ ok: false, unreachable: false })
    })
  })
}

;(async () => {
  let unreachable = true
  for (let n = 1; n <= ATTEMPTS; n++) {
    const r = await attempt(n)
    if (r.ok) process.exit(0)
    unreachable = unreachable && r.unreachable
  }
  if (unreachable) {
    console.warn('[db-push] the database cannot be reached: the build goes on WITHOUT the schema push (it runs on the next build that reaches it)')
    process.exit(0)
  }
  console.error('[db-push] failed; the build stops here and the live version is unchanged')
  process.exit(1)
})()
