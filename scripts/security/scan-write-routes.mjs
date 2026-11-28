/**
 * SECURITY / MONEY deep check (owner 28/11): a static scan of every API route that CHANGES data (POST / PUT / PATCH /
 * DELETE). For each handler it reports what protects it, so nothing slips through unseen:
 *   auth      – a session / permission check (or a token / secret for public & webhook routes)
 *   perm      – a permission (RBAC) check, not only "signed in"
 *   zod       – the body is validated with a schema
 *   monthLock – money routes wrapped in withMonthLock (writes into a closed month are refused)
 * Prints only the routes that miss something worth a look.   node scripts/security/scan-write-routes.mjs [--all]
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = 'app/api'
const ALL = process.argv.includes('--all')
const files = []
const walk = (d) => { for (const n of readdirSync(d)) { const p = join(d, n); statSync(p).isDirectory() ? walk(p) : n === 'route.ts' && files.push(p) } }
walk(ROOT)

const MONEY = /(fee|pay|invoice|refund|wallet|topup|withdraw|treasury|expense|salar|discount|partner-statement|partner_statement|month-close|budget|penalt|void|cash|online|paymob|price|codes|bookings)/i
const PUBLIC_OK = /(api\/public|api\/auth|webhooks|card-check|verify|health|version|logo|security\/csp-report|passport\/public|h5p\/\[blockId\]\/f|videos\/p\/|account\/setup|admissions\/apply|staff-applications\/apply|landing\/inquiries|cron\/)/

const rows = []
for (const f of files) {
  const s = readFileSync(f, 'utf8')
  const methods = ['POST', 'PUT', 'PATCH', 'DELETE'].filter((m) => new RegExp(`export\\s+(async\\s+function|const)\\s+${m}\\b`).test(s) || new RegExp(`export\\s*\\{[^}]*\\b${m}\\b`).test(s))
  if (!methods.length) continue
  const path = f.replace(/\\/g, '/')
  const reexport = /^export \{ [A-Z, ]+ \} from/m.test(s) && s.split('\n').filter((l) => l.trim()).length < 4
  const auth = /[a-zA-Z]+(User|Admin|Staff)\(|requireSuperAdmin|requireSession|requirePermission|requireAuth|auth\(\)|getServerSession|verifyCron|CRON_SECRET|hmac|HMAC|token|guard\(|withAuth|requireStaff|requirePortal|session/i.test(s)
  const perm = /[a-zA-Z]+(User|Admin|Staff)\(|requireSuperAdmin|requirePermission|checkPermission|canSee|hasPermission|useMyPermissions|can\(|allowsCampus|permissionFor|effectivePermission|isSuperAdmin|role\s*(===|!==|in)|\.includes\(session\.user\.role|ROLES|countOnly|guard\(/.test(s)
  const zod = /z\.object|safeParse|\.parse\(/.test(s)
  const money = MONEY.test(path)
  const monthLock = /withMonthLock|closedMonthMessage|MonthLocked/.test(s)
  const isPublic = PUBLIC_OK.test(path)
  const issues = []
  if (reexport) continue
  if (!auth && !isPublic) issues.push('NO-AUTH')
  if (auth && !perm && !isPublic) issues.push('login-only')
  if (!zod) issues.push('no-schema')
  if (money && !monthLock && !isPublic) issues.push('money-no-monthlock')
  if (ALL || issues.length) rows.push({ path, methods: methods.join(','), issues })
}
rows.sort((a, b) => b.issues.length - a.issues.length || a.path.localeCompare(b.path))
for (const r of rows) console.log(`${r.issues.join(' ').padEnd(40)} ${r.methods.padEnd(18)} ${r.path}`)
console.log(`\n${files.length} route files, ${rows.length} write routes listed`)
