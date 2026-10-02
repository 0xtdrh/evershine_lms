#!/usr/bin/env node
/**
 * Live check + demo data for TechNova (runs against the REAL site).
 *
 *   node scripts/live-check.mjs            # run the checks, leave demo data to explore
 *   node scripts/live-check.mjs --cleanup  # remove ONLY the demo data
 *
 * Asks for the site address, the Super Admin email and password at run time.
 * The password is never printed, saved or sent anywhere except the login.
 *
 * Everything it creates is marked as demo (students "DEMO-TEST", parents with
 * phones 0109990…, group "DEMO …", discount types "DEMO …", staff
 * @demo.technova.local). Demo discount types are limited to the demo group, so
 * real students are never affected. Removal: --cleanup (or the API
 * DELETE /api/admin/demo-data), which deletes only those records.
 *
 * What it checks (owner's list, 2026-10-02):
 *  payment settings · discount rules · discount types · siblings discount ·
 *  "apply to current invoice?" · approval flow · report ·
 *  password change signs out old sessions · deactivated staff signed out ·
 *  parent uploads a payment proof · accountant approves it · receipt ·
 *  refund to the student wallet.
 */

import readline from 'node:readline'
import { randomInt } from 'node:crypto'

// ── tiny cookie-keeping HTTP client ─────────────────────────────────────────
class Client {
  constructor(base) { this.base = base; this.cookies = new Map() }
  store(res) {
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(';')
      const i = pair.indexOf('=')
      this.cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1))
    }
  }
  header() { return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ') }
  async raw(method, path, { body, form, multipart } = {}) {
    const headers = { cookie: this.header() }
    let payload
    if (form) { headers['content-type'] = 'application/x-www-form-urlencoded'; payload = new URLSearchParams(form) }
    else if (multipart) payload = multipart
    else if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body) }
    const res = await fetch(this.base + path, { method, headers, body: payload, redirect: 'manual' })
    this.store(res)
    return res
  }
  async json(method, path, opts) {
    const res = await this.raw(method, path, opts)
    let data = null
    try { data = await res.json() } catch { /* not json */ }
    return { status: res.status, data }
  }
  async login(email, password) {
    const csrf = await this.json('GET', '/api/auth/csrf')
    const res = await this.raw('POST', '/api/auth/callback/credentials', {
      form: { csrfToken: csrf.data?.csrfToken ?? '', email, password, callbackUrl: `${this.base}/dashboard` },
    })
    const location = res.headers.get('location') ?? ''
    return !location.includes('error=')
  }
}

// ── output ──────────────────────────────────────────────────────────────────
let passed = 0, failed = 0
const ok = (m) => { passed++; console.log(`  ✅ ${m}`) }
const bad = (m, extra) => { failed++; console.log(`  ❌ ${m}${extra ? `  (${extra})` : ''}`) }
const check = (m, cond, extra) => (cond ? ok(m) : bad(m, extra))
const section = (t) => console.log(`\n== ${t}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const list = (d) => (Array.isArray(d?.data) ? d.data : Array.isArray(d?.data?.items) ? d.data.items : [])

// ── prompts (password hidden) ───────────────────────────────────────────────
// One readline for all questions (also works when answers are piped in:
// lines that arrive early are queued instead of lost).
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: !!process.stdin.isTTY })
let muted = false
rl._writeToOutput = function (s) { if (!muted) rl.output.write(s) }
const queued = []
let waiting = null
rl.on('line', (line) => { if (waiting) { const w = waiting; waiting = null; w(line) } else queued.push(line) })
function ask(question, { hidden = false } = {}) {
  rl.output.write(question)
  muted = hidden
  const done = (a) => {
    muted = false
    if (hidden) rl.output.write('\n')
    return a.trim()
  }
  if (queued.length) return Promise.resolve(done(queued.shift()))
  return new Promise((resolve) => { waiting = (line) => resolve(done(line)) })
}

// 1x1 PNG (valid image) for the payment-proof upload
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')

async function main() {
  const cleanupOnly = process.argv.includes('--cleanup')
  console.log('TechNova live check' + (cleanupOnly ? ' — remove demo data' : ''))
  const base = ((await ask('Site address [https://evershine-lms-technova.vercel.app]: ')) || 'https://evershine-lms-technova.vercel.app').replace(/\/+$/, '')
  const email = await ask('Super Admin email: ')
  const password = await ask('Super Admin password (hidden): ', { hidden: true })

  const sa = new Client(base)
  if (!(await sa.login(email, password))) { console.log('❌ Could not sign in (wrong email/password, or sign-in locked for 15 minutes).'); process.exit(1) }
  const me = await sa.json('GET', '/api/auth/session')
  if (me.data?.user?.role !== 'SUPER_ADMIN') { console.log('❌ This account is not a Super Admin.'); process.exit(1) }
  console.log('Signed in.')

  if (cleanupOnly) {
    const before = await sa.json('GET', '/api/admin/demo-data')
    console.log('Demo records found:', JSON.stringify(before.data?.data ?? {}))
    const r = await sa.json('DELETE', '/api/admin/demo-data')
    check('demo data removed (real data untouched)', r.data?.success, r.data?.error?.message)
    return finish()
  }

  const run = String(randomInt(1000, 9999))
  const phone = (n) => `0109990${run.slice(0, 2)}${String(n).padStart(2, '0')}`
  let originalRules = null

  try {
    // ── 1. payment settings ─────────────────────────────────────────────────
    section('1. Payment settings')
    const fs = await sa.json('GET', '/api/admin/finance-settings')
    check('payment settings page works', fs.data?.success)
    const settings = fs.data?.data
    if (settings && settings.accounts.length === 0) {
      const save = await sa.json('PUT', '/api/admin/finance-settings', {
        body: {
          finance: settings.finance,
          methods: settings.methods.map((m) => ({ id: m.id, name: m.name, isActive: m.isActive })),
          accounts: [{ kind: 'INSTAPAY', label: 'DEMO InstaPay (replace with the real one)', accountNumber: 'demo@instapay', accountName: 'TechNova', isActive: true }],
        },
      })
      check('no account yet: added a DEMO InstaPay account (replace it with yours!)', save.data?.success, save.data?.error?.message)
    } else {
      ok(`${settings?.accounts.length ?? 0} payment account(s) already set`)
    }
    const pa = await sa.json('GET', '/api/payment-accounts')
    check('parents see where to send money', !!pa.data?.data?.snapshot)
    check('payment methods list has InstaPay / Vodafone Cash', (settings?.methods ?? []).some((m) => m.name === 'InstaPay'))

    // ── 2. discount rules ───────────────────────────────────────────────────
    section('2. Discount rules')
    const rules = await sa.json('GET', '/api/discounts/rules')
    originalRules = rules.data?.data ?? null
    const setRules = await sa.json('PUT', '/api/discounts/rules', { body: { allowStacking: true, maxTotalPercent: 50, siblingAppliesTo: 'SECOND_AND_LATER' } })
    check('rules saved (combine ON, max 50%, siblings: 2nd and later)', setRules.data?.success)

    // ── 3. demo group ───────────────────────────────────────────────────────
    section('3. Demo group')
    const campuses = list((await sa.json('GET', '/api/campuses')).data)
    const campus = campuses.find((c) => c.isActive !== false) ?? campuses[0]
    const batches = list((await sa.json('GET', `/api/batches?campusId=${campus?.id}`)).data)
    const shifts = list((await sa.json('GET', '/api/shifts')).data)
    const opts = (await sa.json('GET', '/api/discounts/options')).data?.data
    const course = opts?.courses.find((c) => /nova/i.test(c.name)) ?? opts?.courses[0]
    const level = opts?.levels.find((l) => l.subjectId === course?.id)
    check('branch, batch, shift and a level found', campus && batches[0] && shifts[0] && level, `${campus?.name ?? '-'} / ${batches[0]?.name ?? '-'} / ${shifts[0]?.name ?? '-'} / ${level?.name ?? '-'}`)
    const groupName = `DEMO Group ${run}`
    const g = await sa.json('POST', '/api/groups', {
      body: { campusId: campus.id, batchId: batches[0].id, shiftId: shifts[0].id, className: groupName, sectionName: 'D', levelId: level.id },
    })
    const groupId = g.data?.data?.id
    check(`group "${groupName}" created (${course?.name} — ${level?.name})`, !!groupId, g.data?.error?.message)

    // ── 4. discount types (limited to the demo group) ───────────────────────
    section('4. Discount types')
    const mkType = (t) => sa.json('POST', '/api/discount-types', { body: { scopeType: 'GROUP', scopeId: groupId, stackable: true, ...t } })
    const tSib = await mkType({ name: `DEMO Siblings 10% ${run}`, kind: 'SIBLING', valueType: 'PERCENT', value: 10, duration: 'EVERY_CYCLE', autoApply: true, approvalMode: 'STAFF' })
    const tMan = await mkType({ name: `DEMO Manual 15% ${run}`, kind: 'MANUAL', valueType: 'PERCENT', value: 15, duration: 'EVERY_CYCLE', autoApply: false, approvalMode: 'STAFF_WITH_APPROVAL' })
    check('"DEMO Siblings 10%" (automatic) created', tSib.data?.success, tSib.data?.error?.message)
    check('"DEMO Manual 15%" (needs manager approval) created', tMan.data?.success, tMan.data?.error?.message)

    // ── 5. siblings ─────────────────────────────────────────────────────────
    section('5. Siblings discount')
    const stu = (first, studentPhone, guardianPhone) => ({
      firstName: first, lastName: 'DEMO-TEST', fullNameAr: `تجربة ${first}`, fatherName: `Father ${first}`, fatherPhoneNumber: '', motherName: '',
      parentStatus: 'BOTH_ALIVE', dateOfBirth: '2016-05-10T00:00:00.000Z', gender: 'MALE', nationality: 'Egyptian', address: '12 Demo St Hurghada',
      city: 'Hurghada', phoneNumber: studentPhone, emergencyContact: studentPhone, email: '', hasSiblingAtAcademy: false, campusId: campus.id,
      batchId: batches[0].id, rollNumber: '', totalFeeAmount: 0, academicYear: `${new Date().getFullYear()}-${new Date().getFullYear() + 1}`, guardianFirstName: guardianPhone ? 'Demo Parent' : '', guardianLastName: '',
      guardianPhone: guardianPhone ?? '', guardianEmail: '', guardianRelationship: '',
    })
    let studentError = ''
    const mkStudent = async (first, n, guardianPhone) => {
      const r = await sa.json('POST', '/api/students', { body: stu(first, phone(n), guardianPhone) })
      if (!r.data?.success) studentError = JSON.stringify(r.data?.error ?? r.data).slice(0, 300)
      return r.data?.data
    }
    const s1 = await mkStudent(`Sib1-${run}`, 1, phone(9))
    const s2 = await mkStudent(`Sib2-${run}`, 2, phone(9))
    const solo = await mkStudent(`Solo-${run}`, 3, phone(8))
    check('3 demo students created (2 brothers with the same parent phone)', s1?.id && s2?.id && solo?.id, studentError)
    if (!(s1?.id && s2?.id && solo?.id)) throw new Error('cannot continue without the demo students')
    for (const s of [s1, s2, solo]) await sa.json('POST', `/api/groups/${groupId}/students`, { body: { studentId: s.id } })
    const invoiceOf = async (studentId) => {
      const inv = list((await sa.json('GET', `/api/fees?studentId=${studentId}&limit=20`)).data).find((i) => i.classSectionId === groupId)
      return inv ? (await sa.json('GET', `/api/fees/${inv.id}`)).data?.data : null
    }
    const i1 = await invoiceOf(s1.id)
    const i2 = await invoiceOf(s2.id)
    const has = (inv, name) => (inv?.discountLines ?? []).some((l) => l.label === name)
    check(`each student got an invoice (${i2?.challanNumber ?? '-'})`, i1 && i2)
    check('first brother (registered first): no sibling discount', i1 && !has(i1, `DEMO Siblings 10% ${run}`))
    check(`second brother: sibling discount on the invoice (${Number(i2?.discount ?? 0)} EGP off ${Number(i2?.subtotal ?? 0)})`, has(i2, `DEMO Siblings 10% ${run}`))
    check('invoice shows the payment accounts', !!i2?.bankAccounts && !/Ali Aslam/.test(i2.bankAccounts))

    // ── 6. approval flow with a demo accountant ─────────────────────────────
    section('6. Discount needing approval (demo accountant asks, you approve)')
    const accEmail = `accountant-${run}${'@demo.technova.local'}`
    const accPass1 = `Demo${run}Aa1`
    const acc = await sa.json('POST', '/api/users/create-accountant', {
      body: { firstName: 'Demo', lastName: `Accountant ${run}`, email: accEmail, password: accPass1, phoneNumber: phone(7), campusId: campus.id },
    })
    const accUserId = acc.data?.data?.userId
    check('demo accountant account created', !!accUserId, acc.data?.error?.message)
    const accC = new Client(base)
    check('demo accountant signs in', await accC.login(accEmail, accPass1))
    const req = await accC.json('POST', '/api/discounts', { body: { discountTypeId: tMan.data.data.id, studentId: solo.id, classSectionId: groupId, reason: 'demo request' } })
    const reqId = req.data?.data?.assignment?.id
    check('accountant request is PENDING (waits for a manager)', req.data?.data?.assignment?.status === 'PENDING', req.data?.error?.message)
    check('accountant cannot approve it himself', (await accC.json('PATCH', `/api/discounts/${reqId}`, { body: { action: 'approve' } })).status === 403)
    const appr = await sa.json('PATCH', `/api/discounts/${reqId}`, { body: { action: 'approve' } })
    const affected = appr.data?.data?.affectedInvoices ?? []
    check('you approved it', appr.data?.data?.assignment?.status === 'ACTIVE')
    check('the system ASKS about the unpaid invoice', affected.length >= 1)
    const applied = await sa.json('POST', `/api/discounts/${reqId}/apply`, { body: { invoiceIds: affected.map((i) => i.id) } })
    const iSolo = await invoiceOf(solo.id)
    check(`"yes" applied it to the current invoice (${Number(iSolo?.totalAmount ?? 0)} EGP to pay)`, applied.data?.success && has(iSolo, `DEMO Manual 15% ${run}`))

    // ── 7. report ───────────────────────────────────────────────────────────
    section('7. Discount report')
    const rep = await sa.json('GET', '/api/discounts/report')
    check(`report works (this month: ${rep.data?.data?.total ?? 0} EGP of discounts)`, rep.data?.success && rep.data.data.total > 0)

    // ── 8. parent uploads a payment proof, accountant approves ──────────────
    section('8. Parent pays by transfer and uploads the receipt')
    const sib2 = (await sa.json('GET', `/api/students/${s2.id}`)).data?.data
    const guardian = sib2?.guardians?.[0]
    const temp = await sa.json('POST', `/api/students/${s2.id}/portal-password`, { body: { target: 'guardian', guardianId: guardian?.id } })
    const parent = new Client(base)
    check('parent signs in with phone + temporary password', !!temp.data?.data?.password && (await parent.login(guardian.phoneNumber, temp.data.data.password)))
    const form = new FormData()
    form.append('file', new Blob([PNG], { type: 'image/png' }), 'receipt.png')
    form.append('remarks', 'Demo InstaPay transfer')
    const up = await parent.json('POST', `/api/fees/${i2.id}/proof`, { multipart: form })
    check('parent uploaded the receipt (stored on Cloudinary)', up.status === 200, up.data?.error?.message ?? up.data?.error)
    const approve = await sa.json('PATCH', `/api/accountant/fees/invoices/${i2.id}/proof`, { body: { action: 'APPROVE' } })
    const after = (await sa.json('GET', `/api/fees/${i2.id}`)).data?.data
    check(`receipt approved -> invoice ${after?.status}`, approve.data?.success && after?.status === 'PAID', approve.data?.error?.message)
    const paymentId = approve.data?.data?.paymentId
    const rc = paymentId ? await sa.json('GET', `/api/payments/${paymentId}/receipt`) : null
    check(`payment receipt ${rc?.data?.data?.receiptNumber ?? ''} ready (print / WhatsApp)`, !!rc?.data?.data?.receiptNumber)
    check('parent can open the receipt too', paymentId ? (await parent.json('GET', `/api/payments/${paymentId}/receipt`)).status === 200 : false)

    // ── 8b. refund to the student wallet ─────────────────────────────────────
    section('8b. Refund to the student wallet')
    const sug = await sa.json('GET', `/api/refunds/suggest?invoiceId=${i2.id}`)
    check(`refund suggestion works (suggested ${sug.data?.data?.suggested ?? '-'} EGP)`, sug.data?.success)
    const refundAmount = Math.min(50, sug.data?.data?.maxRefundable ?? 0)
    const rf = refundAmount > 0
      ? await sa.json('POST', '/api/refunds', { body: { invoiceId: i2.id, amount: refundAmount, method: 'WALLET', reason: 'demo refund' } })
      : null
    check(`refund of ${refundAmount} EGP approved (${rf?.data?.data?.refundNumber ?? '-'})`, rf?.data?.data?.status === 'APPROVED', rf?.data?.error?.message)
    const wal = await sa.json('GET', `/api/students/${s2.id}/wallet`)
    check(`wallet credited (${wal.data?.data?.balance ?? 0} EGP)`, (wal.data?.data?.balance ?? 0) >= refundAmount)

    // ── 9. security ─────────────────────────────────────────────────────────
    section('9. Security (waits about 70 seconds)')
    check('accountant session works', (await accC.json('GET', '/api/me/permissions')).status === 200)
    const accPass2 = `Demo${run}Bb2`
    const ch = await accC.json('POST', '/api/users/change-password', { body: { currentPassword: accPass1, newPassword: accPass2, confirmPassword: accPass2 } })
    check('accountant changed his password', ch.data?.success, ch.data?.error?.message)
    await sleep(35_000)
    check('after a password change, the old session is signed out', (await accC.json('GET', '/api/me/permissions')).status === 401)
    const accC2 = new Client(base)
    check('signs in again with the new password', (await accC2.login(accEmail, accPass2)) && (await accC2.json('GET', '/api/me/permissions')).status === 200)
    const off = await sa.json('PATCH', `/api/users/${accUserId}/role`, { body: { isActive: false } })
    check('you deactivated the accountant', off.data?.success, off.data?.error?.message)
    await sleep(35_000)
    check('a deactivated account is signed out within ~30 s (was 8 hours)', (await accC2.json('GET', '/api/me/permissions')).status === 401)
  } catch (err) {
    bad('the check stopped unexpectedly', err?.message ?? String(err))
  } finally {
    if (originalRules) {
      const back = await sa.json('PUT', '/api/discounts/rules', { body: originalRules })
      check('your discount rules restored as they were', back.data?.success)
    }
  }
  console.log(`\nDemo data left for you to explore: group "DEMO Group ${run}", students *-${run} DEMO-TEST.`)
  console.log('Remove it any time with:  node scripts/live-check.mjs --cleanup')
  return finish()
}

function finish() {
  rl.close()
  console.log(`\nRESULT: ${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
