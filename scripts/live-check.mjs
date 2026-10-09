#!/usr/bin/env node
/**
 * Live check + demo data for TechNova (runs against the REAL site).
 *
 *   node scripts/live-check.mjs            # run the checks, leave demo data to explore
 *   node scripts/live-check.mjs --cleanup  # remove ONLY the demo data
 *   node scripts/live-check.mjs --transfer # only try moving students between groups (2026-10-03)
 *   node scripts/live-check.mjs --schedule # only make demo data for the Groups calendar (2026-10-03)
 *   node scripts/live-check.mjs --phase-a  # demo data for phase A: capacity/waiting, contact log, renewals
 *   node scripts/live-check.mjs --phase-b  # demo data for phase B: wallets, top-ups, auto-pay, siblings, withdrawal
 *   node scripts/live-check.mjs --phase-c  # demo data for phase C: excuses, attendance alerts, ratings, birthdays, reports
 *   node scripts/live-check.mjs --logins   # demo instructor + student + parent you can sign in with (printed once, removed by --cleanup)
 *   node scripts/live-check.mjs --phase-d  # demo data for phase D: referral (code → new student → first payment), complaints
 *   node scripts/live-check.mjs --lms      # LMS L1: demo curriculum version, every content type, private upload, review, publish, export/import
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
 *  refund to the student wallet · moving a student to another group.
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
  const transferOnly = process.argv.includes('--transfer')
  const scheduleOnly = process.argv.includes('--schedule')
  const phaseAOnly = process.argv.includes('--phase-a')
  const phaseBOnly = process.argv.includes('--phase-b')
  const phaseCOnly = process.argv.includes('--phase-c')
  const loginsOnly = process.argv.includes('--logins')
  const phaseDOnly = process.argv.includes('--phase-d')
  const lmsOnly = process.argv.includes('--lms')
  console.log('TechNova live check' + (cleanupOnly ? ' — remove demo data' : transferOnly ? ' — moving students between groups' : scheduleOnly ? ' — demo data for the Groups calendar' : phaseAOnly ? ' — demo data for phase A' : phaseBOnly ? ' — demo data for phase B (wallets)' : phaseCOnly ? ' — demo data for phase C' : loginsOnly ? ' — demo accounts to sign in with' : phaseDOnly ? ' — demo data for phase D' : lmsOnly ? ' — LMS L1 curriculum library' : ''))
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
  if (lmsOnly) {
    try { await lmsDemo(sa, base, run) } catch (err) { bad('the check stopped unexpectedly', err?.message ?? String(err)) }
    console.log('\nDemo data left for you to explore. Remove it any time with:  node scripts/live-check.mjs --cleanup')
    return finish()
  }
  if (phaseDOnly) {
    try { await phaseDDemo(sa, base, run, phone) } catch (err) { bad('the check stopped unexpectedly', err?.message ?? String(err)) }
    console.log('\nDemo data left for you to explore. Remove it any time with:  node scripts/live-check.mjs --cleanup')
    return finish()
  }
  if (loginsOnly) {
    try { await demoLogins(sa, base, run, phone) } catch (err) { bad('the check stopped unexpectedly', err?.message ?? String(err)) }
    console.log('\nThese are DEMO accounts only. Remove them (and all demo data) any time with:  node scripts/live-check.mjs --cleanup')
    return finish()
  }
  if (phaseCOnly) {
    try { await phaseCDemo(sa, base, run, phone) } catch (err) { bad('the check stopped unexpectedly', err?.message ?? String(err)) }
    console.log('\nDemo data left for you to explore. Remove it any time with:  node scripts/live-check.mjs --cleanup')
    return finish()
  }
  if (phaseBOnly) {
    try { await phaseBDemo(sa, base, run, phone) } catch (err) { bad('the check stopped unexpectedly', err?.message ?? String(err)) }
    console.log('\nDemo data left for you to explore. Remove it any time with:  node scripts/live-check.mjs --cleanup')
    return finish()
  }
  if (phaseAOnly) {
    try { await phaseADemo(sa, base, run, phone) } catch (err) { bad('the check stopped unexpectedly', err?.message ?? String(err)) }
    console.log('\nDemo data left for you to explore. Remove it any time with:  node scripts/live-check.mjs --cleanup')
    return finish()
  }
  if (scheduleOnly) {
    try { await scheduleDemo(sa, base, run, phone) } catch (err) { bad('the check stopped unexpectedly', err?.message ?? String(err)) }
    console.log('\nDemo data left for you to explore. Remove it any time with:  node scripts/live-check.mjs --cleanup')
    return finish()
  }
  if (transferOnly) {
    try { await transferChecks(sa, run, phone) } catch (err) { bad('the check stopped unexpectedly', err?.message ?? String(err)) }
    console.log('\nDemo data left for you to explore. Remove it any time with:  node scripts/live-check.mjs --cleanup')
    return finish()
  }
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

    await transferChecks(sa, run, phone)

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

// ── moving a student to another group (docs/design-student-transfer.md) ─────
// Own demo groups/students/discount type (all marked DEMO, removed by --cleanup).
async function transferChecks(sa, run, phone) {
  section('10. Move a student to another group')
  const n = (v) => Number(v ?? 0)
  const r2 = (v) => Math.round(v * 100) / 100
  const near = (a, b) => Math.abs(n(a) - n(b)) < 0.02
  const campuses = list((await sa.json('GET', '/api/campuses')).data)
  const campus = campuses.find((c) => c.isActive !== false) ?? campuses[0]
  const batch = list((await sa.json('GET', `/api/batches?campusId=${campus?.id}`)).data)[0]
  const shift = list((await sa.json('GET', '/api/shifts')).data)[0]
  const opts = (await sa.json('GET', '/api/discounts/options')).data?.data
  const levels = opts?.levels ?? []
  const fromLevel = levels[0]
  const toLevel = levels.find((l) => l.subjectId !== fromLevel?.subjectId) ?? levels[1] ?? fromLevel
  if (!campus || !batch || !shift || !fromLevel) return bad('branch, batch, shift and levels needed to try a move')
  const mkGroup = async (name, levelId) => (await sa.json('POST', '/api/groups', {
    body: { campusId: campus.id, batchId: batch.id, shiftId: shift.id, className: name, sectionName: 'M', levelId, installmentsAllowed: true },
  })).data?.data?.id
  const fromId = await mkGroup(`DEMO Move From ${run}`, fromLevel.id)
  const toId = await mkGroup(`DEMO Move To ${run}`, toLevel.id)
  check(`two demo groups: "DEMO Move From ${run}" (${fromLevel.name}) and "DEMO Move To ${run}" (${toLevel.name})`, fromId && toId)
  if (!fromId || !toId) return

  const year = new Date().getFullYear()
  const mkStudent = async (first, k) => (await sa.json('POST', '/api/students', {
    body: {
      firstName: first, lastName: 'DEMO-TEST', fullNameAr: `تجربة ${first}`, fatherName: `Father ${first}`, fatherPhoneNumber: '', motherName: '',
      parentStatus: 'BOTH_ALIVE', dateOfBirth: '2016-05-10T00:00:00.000Z', gender: 'MALE', nationality: 'Egyptian', address: '12 Demo St Hurghada',
      city: 'Hurghada', phoneNumber: phone(k), emergencyContact: phone(k), email: '', hasSiblingAtAcademy: false, campusId: campus.id,
      batchId: batch.id, rollNumber: '', totalFeeAmount: 0, academicYear: `${year}-${year + 1}`, guardianFirstName: 'Demo Parent', guardianLastName: '',
      guardianPhone: phone(k + 40), guardianEmail: '', guardianRelationship: '',
    },
  })).data?.data
  const a = await mkStudent(`MoveA-${run}`, 21)
  const b = await mkStudent(`MoveB-${run}`, 22)
  check('2 demo students created', a?.id && b?.id)
  if (!a?.id || !b?.id) return
  for (const s of [a, b]) await sa.json('POST', `/api/groups/${fromId}/students`, { body: { studentId: s.id } })

  const invoiceIn = async (studentId, groupId) => {
    const row = list((await sa.json('GET', `/api/fees?studentId=${studentId}&limit=50`)).data).find((i) => i.classSectionId === groupId && i.status !== 'CANCELLED')
    return row ? (await sa.json('GET', `/api/fees/${row.id}`)).data?.data : null
  }
  const ia = await invoiceIn(a.id, fromId)
  const ib = await invoiceIn(b.id, fromId)
  check(`both got an invoice in the old group (${n(ia?.totalAmount)} EGP)`, ia && ib && n(ia.totalAmount) > 0, 'the level needs a price')
  if (!ia || !ib || !(n(ia.totalAmount) > 0)) return
  const payA = await sa.json('POST', `/api/fees/${ia.id}/payments`, { body: { amount: n(ia.totalAmount), paymentMethod: 'Cash' } })
  const smallPay = r2(Math.min(100, n(ib.totalAmount) / 10))
  const payB = await sa.json('POST', `/api/fees/${ib.id}/payments`, { body: { amount: smallPay, paymentMethod: 'Cash' } })
  check(`student A paid everything, student B paid only ${smallPay} EGP`, payA.data?.success && payB.data?.success, payA.data?.error?.message ?? payB.data?.error?.message)

  // attendance: A came once, B twice
  const detail = (await sa.json('GET', `/api/groups/${fromId}`)).data?.data
  const enr = (sid) => detail?.enrollments?.find((e) => e.student.id === sid)?.id
  const day = (k) => new Date(Date.now() - k * 86400000).toISOString().slice(0, 10)
  const att1 = await sa.json('POST', '/api/enrollment-attendance', { body: { classSectionId: fromId, attendanceDate: day(1), records: [{ studentEnrollmentId: enr(a.id), status: 'PRESENT' }, { studentEnrollmentId: enr(b.id), status: 'PRESENT' }] } })
  const att2 = await sa.json('POST', '/api/enrollment-attendance', { body: { classSectionId: fromId, attendanceDate: day(0), records: [{ studentEnrollmentId: enr(a.id), status: 'ABSENT' }, { studentEnrollmentId: enr(b.id), status: 'PRESENT' }] } })
  check('2 sessions recorded: A attended 1, B attended 2', att1.data?.success !== false && att2.data?.success !== false, att1.data?.error?.message ?? att2.data?.error?.message)

  // a discount on A in the old group (manual type: never applied to anyone by itself)
  const type = await sa.json('POST', '/api/discount-types', {
    body: { name: `DEMO Move 10% ${run}`, kind: 'MANUAL', valueType: 'PERCENT', value: 10, duration: 'EVERY_CYCLE', autoApply: false, approvalMode: 'STAFF', stackable: true },
  })
  const asg = await sa.json('POST', '/api/discounts', { body: { discountTypeId: type.data?.data?.id, studentId: a.id, classSectionId: fromId, reason: 'demo move' } })
  const asgId = asg.data?.data?.assignment?.id
  check('discount "DEMO Move 10%" given to A in the old group', !!asgId, asg.data?.error?.message ?? type.data?.error?.message)

  // preview
  const pv = (await sa.json('GET', `/api/students/${a.id}/transfer?from=${fromId}&to=${toId}`)).data?.data
  const inv = pv?.invoice
  const expectedCredit = inv ? r2(Math.max(0, inv.netPaid - inv.consumed)) : NaN
  check(`preview: paid ${inv?.netPaid}, ${inv?.sessionsCounted} session × ${inv?.perSession} = ${inv?.consumed}, credit ${inv?.credit} EGP`,
    inv && inv.sessionsCounted === 1 && near(inv.consumed, Math.min(inv.perSession, n(ia.totalAmount))) && near(inv.credit, expectedCredit))
  const dA = pv?.discounts?.find((d) => d.assignmentId === asgId)
  check(`preview asks about the discount (suggests: ${dA?.suggested})`, dA?.suggested === 'MOVE')
  const noAnswer = await sa.json('POST', `/api/students/${a.id}/transfer`, { body: { fromClassSectionId: fromId, toClassSectionId: toId, creditTo: 'NEW_INVOICE' } })
  check('moving without answering about the discount is refused', noAnswer.data?.success === false)

  // move A: credit onto the new invoice, discount moves with him
  const mvA = (await sa.json('POST', `/api/students/${a.id}/transfer`, {
    body: { fromClassSectionId: fromId, toClassSectionId: toId, creditTo: 'NEW_INVOICE', discountDecisions: [{ assignmentId: asgId, action: 'MOVE' }], reason: 'demo: another course' },
  })).data
  check(`A moved (credit ${mvA?.data?.credit} EGP, ${mvA?.data?.creditApplied} paid onto the new invoice)`, mvA?.success && near(mvA.data.credit, expectedCredit), mvA?.error?.message)
  const oldA = (await sa.json('GET', `/api/fees/${ia.id}`)).data?.data
  check(`old invoice: ${n(oldA?.refundedAmount)} EGP given back as credit, ${r2(n(oldA?.paidAmount) - n(oldA?.refundedAmount))} kept for the session`, near(oldA?.refundedAmount, expectedCredit))
  const newA = await invoiceIn(a.id, toId)
  check(`new invoice ${newA?.challanNumber ?? '-'} has the moved discount`, (newA?.discountLines ?? []).some((l) => l.label === `DEMO Move 10% ${run}`))
  check(`credit paid on the new invoice with a receipt (${newA?.payments?.[0]?.receiptNumber ?? '-'})`, near(newA?.paidAmount, mvA?.data?.creditApplied) && !!newA?.payments?.[0]?.receiptNumber)
  const walA = (await sa.json('GET', `/api/students/${a.id}/wallet`)).data?.data
  check(`wallet holds only what the new invoice did not need (${walA?.balance} EGP)`, near(walA?.balance, mvA?.data?.creditLeftInWallet))
  const hist = (await sa.json('GET', `/api/students/${a.id}/transfer`)).data?.data ?? []
  check('move saved in the student history', hist.length === 1 && hist[0].to?.label?.startsWith('DEMO Move To'))
  const again = await sa.json('POST', `/api/students/${a.id}/transfer`, { body: { fromClassSectionId: fromId, toClassSectionId: toId, creditTo: 'WALLET' } })
  check('moving him again from the old group is refused', again.data?.success === false)

  // move B: paid less than used -> no credit, old invoice cut to the sessions
  const mvB = (await sa.json('POST', `/api/students/${b.id}/transfer`, { body: { fromClassSectionId: fromId, toClassSectionId: toId, creditTo: 'WALLET' } })).data
  const oldB = (await sa.json('GET', `/api/fees/${ib.id}`)).data?.data
  check(`B moved: no credit, ${mvB?.data?.oldInvoice?.owed} EGP still due, ${mvB?.data?.oldInvoice?.cancelled} EGP cancelled`, mvB?.success && n(mvB.data.credit) === 0, mvB?.error?.message)
  check(`B's old invoice is now ${n(oldB?.totalAmount)} EGP (only the 2 sessions)`, near(n(oldB?.totalAmount), smallPay + n(mvB?.data?.oldInvoice?.owed)))
  const newB = await invoiceIn(b.id, toId)
  check(`B got a normal invoice in the new group (${n(newB?.totalAmount)} EGP)`, !!newB)
  console.log(`  ↳ open the student "MoveA-${run} DEMO-TEST" → card "Groups & moves" to see it in the screen`)
}

// ── demo data for the Groups calendar (/dashboard/schedule) ─────────────────
// 2 demo instructors, 4 demo groups around today: held sessions, a forgotten
// attendance, a clash, a substitute, a cancelled session and a group that has
// not started. All DEMO-marked, removed by --cleanup.
async function scheduleDemo(sa, base, run, phone) {
  section('11. Demo data for the Groups calendar')
  const iso = (d) => d.toISOString().slice(0, 10)
  const dayOf = (k) => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() + k); return d }
  const date = (k) => iso(dayOf(k))
  const dow = (k) => dayOf(k).getUTCDay()

  const campuses = list((await sa.json('GET', '/api/campuses')).data)
  const campus = campuses.find((c) => c.isActive !== false) ?? campuses[0]
  const batch = list((await sa.json('GET', `/api/batches?campusId=${campus?.id}`)).data)[0]
  const shift = list((await sa.json('GET', '/api/shifts')).data)[0]
  const levels = (await sa.json('GET', '/api/discounts/options')).data?.data?.levels ?? []
  const lvl = (i) => levels[i % Math.max(1, levels.length)]
  if (!campus || !batch || !shift || !levels.length) return bad('branch, batch, shift and levels needed')

  // instructors
  const year = new Date().getFullYear()
  const teachers = []
  for (const [i, name] of ['Ahmed', 'Mona'].entries()) {
    const email = `cal-${name.toLowerCase()}-${run}@demo.technova.local`
    const password = `Demo${run}Tt${i}`
    const r = await sa.json('POST', '/api/teachers', {
      body: {
        firstName: name, lastName: `DEMO ${run}`, cnic: `29${run}${String(1000000 + i).slice(1)}${i}`.slice(0, 13).padEnd(13, '7'),
        dateOfBirth: '1992-03-15T00:00:00.000Z', gender: i ? 'FEMALE' : 'MALE', qualification: 'BSc Engineering',
        joiningDate: `${year}-01-01T00:00:00.000Z`, designation: 'Teacher', phoneNumber: phone(60 + i), email,
        address: '12 Demo St Hurghada', city: 'Hurghada', emergencyContact: phone(70 + i), campusId: campus.id, password,
      },
    })
    const id = r.data?.data?.id ?? r.data?.data?.teacher?.id
    check(`demo instructor ${name} created (${email})`, !!id, r.data?.error?.message ?? JSON.stringify(r.data?.error?.details ?? '').slice(0, 200))
    teachers.push({ id, name, email, password })
  }
  const [tA, tB] = teachers
  if (!tA.id || !tB.id) return

  // groups: weekly slots placed around today's weekday
  const slot = (k, time) => ({ dayOfWeek: dow(k), time })
  const plan = [
    { key: 'g1', name: `DEMO Cal Robotics A ${run}`, level: lvl(0), teacher: tA, slots: [slot(-3, '16:00'), slot(-1, '16:00'), slot(2, '16:00')], held: [-10, -8, -3] },
    { key: 'g2', name: `DEMO Cal Robotics B ${run}`, level: lvl(0), teacher: tA, slots: [slot(2, '16:00'), slot(3, '16:00')], held: [-4] },
    { key: 'g3', name: `DEMO Cal Coding ${run}`, level: lvl(1), teacher: tB, slots: [slot(-2, '18:00'), slot(1, '18:00'), slot(3, '18:00')], held: [-9, -2] },
    { key: 'g4', name: `DEMO Cal Kids ${run}`, level: lvl(2), teacher: tB, slots: [slot(0, '17:00'), slot(4, '17:00')], held: [] },
  ]
  const g = {}
  let k = 30
  for (const p of plan) {
    const r = await sa.json('POST', '/api/groups', { body: { campusId: campus.id, batchId: batch.id, shiftId: shift.id, className: p.name, sectionName: 'C', levelId: p.level.id } })
    const id = r.data?.data?.id
    if (!id) { bad(`group ${p.name}`, r.data?.error?.message); continue }
    await sa.json('PATCH', `/api/groups/${id}`, { body: { scheduleSlots: p.slots } })
    await sa.json('POST', `/api/groups/${id}/instructor`, { body: { teacherId: p.teacher.id } })
    for (let s = 0; s < (p.held.length ? 2 : 1); s++) {
      const st = (await sa.json('POST', '/api/students', {
        body: {
          firstName: `Cal${p.key}${s}-${run}`, lastName: 'DEMO-TEST', fullNameAr: `تجربة ${s}`, fatherName: 'Father Demo', fatherPhoneNumber: '', motherName: '',
          parentStatus: 'BOTH_ALIVE', dateOfBirth: '2015-05-10T00:00:00.000Z', gender: 'MALE', nationality: 'Egyptian', address: '12 Demo St Hurghada',
          city: 'Hurghada', phoneNumber: phone(k), emergencyContact: phone(k), email: '', hasSiblingAtAcademy: false, campusId: campus.id,
          batchId: batch.id, rollNumber: '', totalFeeAmount: 0, academicYear: `${year}-${year + 1}`, guardianFirstName: 'Demo Parent', guardianLastName: '',
          guardianPhone: phone(k + 40), guardianEmail: '', guardianRelationship: '',
        },
      })).data?.data
      k++
      if (st?.id) await sa.json('POST', `/api/groups/${id}/students`, { body: { studentId: st.id } })
    }
    const detail = (await sa.json('GET', `/api/groups/${id}`)).data?.data
    const enr = (detail?.enrollments ?? []).map((e) => e.id)
    for (const h of p.held) {
      await sa.json('POST', '/api/enrollment-attendance', {
        body: { classSectionId: id, attendanceDate: date(h), records: enr.map((e, i) => ({ studentEnrollmentId: e, status: i === 1 && h === p.held[0] ? 'ABSENT' : 'PRESENT' })) },
      })
    }
    g[p.key] = id
    ok(`"${p.name}" · ${p.teacher.name} · ${p.slots.map((s) => `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][s.dayOfWeek]} ${s.time}`).join(', ')} · ${p.held.length} session(s) held`)
  }

  // substitute: Mona is absent tomorrow, Ahmed covers (and accepts)
  if (g.g3) {
    const abs = await sa.json('POST', '/api/teacher-absences', { body: { teacherId: tB.id, date: date(1), scope: 'SINGLE_SESSION', classSectionId: g.g3, reason: 'Demo: doctor appointment' } })
    const absId = abs.data?.data?.id
    await sa.json('POST', `/api/teacher-absences/${absId}/respond`, { body: { decision: 'APPROVE' } })
    const asg = await sa.json('POST', `/api/teacher-absences/${absId}/assign-substitute`, { body: { classSectionId: g.g3, substituteTeacherId: tA.id } })
    const asgId = asg.data?.data?.id
    const ahmed = new Client(base)
    let accepted = false
    if (asgId && (await ahmed.login(tA.email, tA.password))) {
      accepted = (await ahmed.json('POST', `/api/substitute-assignments/${asgId}/respond`, { body: { decision: 'ACCEPT' } })).data?.success === true
    }
    check(`tomorrow: ${tB.name} absent, ${tA.name} substitutes${accepted ? ' (accepted)' : ' (waiting for him to accept)'}`, !!asgId, abs.data?.error?.message ?? asg.data?.error?.message)

    // cancelled: Mona absent again in 3 days, no substitute -> session cancelled
    const abs2 = await sa.json('POST', '/api/teacher-absences', { body: { teacherId: tB.id, date: date(3), scope: 'SINGLE_SESSION', classSectionId: g.g3, reason: 'Demo: travel' } })
    const abs2Id = abs2.data?.data?.id
    await sa.json('POST', `/api/teacher-absences/${abs2Id}/respond`, { body: { decision: 'APPROVE' } })
    const cancel = await sa.json('POST', `/api/teacher-absences/${abs2Id}/no-substitute-action`, { body: { classSectionId: g.g3, action: 'CANCEL_SESSION', reason: 'Demo: instructor travelling' } })
    check('in 3 days: a cancelled session (with its reason)', cancel.data?.success, abs2.data?.error?.message ?? cancel.data?.error?.message)
  }

  // what the calendar shows now
  const cal = (await sa.json('GET', `/api/groups/schedule?from=${date(-14)}&to=${date(14)}`)).data?.data
  const mine = (cal?.sessions ?? []).filter((s) => Object.values(g).includes(s.groupId))
  const n = (f) => mine.filter(f).length
  check(`calendar: ${n((s) => s.status === 'HELD')} held, ${n((s) => s.status === 'MISSING')} without attendance, ${n((s) => s.status === 'SCHEDULED')} upcoming, ${n((s) => s.status === 'NOT_STARTED')} not started`, n((s) => s.status === 'HELD') > 0 && n((s) => s.status === 'NOT_STARTED') > 0)
  check(`clash shown (${tA.name} has 2 groups at 16:00 in 2 days)`, mine.some((s) => s.conflict))
  check('substitute shown on its session', mine.some((s) => s.substitute))
  check('cancelled session shown', mine.some((s) => s.status === 'CANCELLED'))
  check('last session of a month flagged', mine.some((s) => s.isLastOfCycle))
  console.log(`  ↳ open Groups Schedule (Week / Month). Filter "All instructors" → ${tA.name} DEMO ${run} to see a clash.`)
  console.log(`  ↳ instructor view: sign in as ${tA.email} / ${tA.password} → My Calendar`)
}

// ── demo data for phase A (contact log, group capacity, renewals) ───────────
// All DEMO-marked, removed by --cleanup. Real branches, holidays and your
// discount rules are NOT changed (a holiday would move real groups' sessions).
async function phaseADemo(sa, base, run, phone) {
  section('12. Demo data for phase A')
  const iso = (k) => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() + k); return d.toISOString().slice(0, 10) }
  const campuses = list((await sa.json('GET', '/api/campuses')).data)
  const campus = campuses.find((c) => c.isActive !== false) ?? campuses[0]
  const levels = (await sa.json('GET', '/api/discounts/options')).data?.data?.levels ?? []
  const level = levels[0]
  if (!campus || !level) return bad('a branch and a level are needed')
  const year = new Date().getFullYear()
  let k = 80
  const mkStudent = async (first) => (await sa.json('POST', '/api/students', {
    body: {
      firstName: `${first}-${run}`, lastName: 'DEMO-TEST', fullNameAr: `تجربة ${first}`, fatherName: 'Father Demo', fatherPhoneNumber: '', motherName: '',
      parentStatus: 'BOTH_ALIVE', dateOfBirth: '2015-05-10T00:00:00.000Z', gender: 'MALE', nationality: 'Egyptian', address: '12 Demo St Hurghada',
      city: 'Hurghada', phoneNumber: phone(k), emergencyContact: phone(k), email: '', hasSiblingAtAcademy: false, campusId: campus.id,
      rollNumber: '', totalFeeAmount: 0, academicYear: `${year}-${year + 1}`, guardianFirstName: 'Demo Parent', guardianLastName: '',
      guardianPhone: phone(k++ + 10), guardianEmail: '', guardianRelationship: '',
    },
  })).data?.data
  const mkGroup = async (name, extra = {}) => (await sa.json('POST', '/api/groups', { body: { campusId: campus.id, className: name, sectionName: 'A', levelId: level.id, ...extra } })).data?.data?.id

  // capacity + waiting
  const full = await mkGroup(`DEMO A Full ${run}`, { maxStudents: 2 })
  const room = await mkGroup(`DEMO A Room ${run}`)
  const [s1, s2, s3] = [await mkStudent('Seat1'), await mkStudent('Seat2'), await mkStudent('Waiting')]
  check('demo groups and students created', full && room && s1?.id && s2?.id && s3?.id)
  if (!full || !room || !s1?.id || !s2?.id || !s3?.id) return
  for (const s of [s1, s2]) await sa.json('POST', `/api/groups/${full}/students`, { body: { studentId: s.id } })
  const refused = await sa.json('POST', `/api/groups/${full}/students`, { body: { studentId: s3.id } })
  check('group "DEMO A Full" (2/2) refuses a third student', refused.data?.error?.code === 'GROUP_FULL')
  const waited = await sa.json('POST', `/api/groups/${full}/students`, { body: { studentId: s3.id, waitlist: true } })
  check(`third student put on its waiting list (#${waited.data?.data?.position ?? '?'})`, waited.data?.data?.waitlisted === true)
  const offered = (await sa.json('GET', `/api/groups/available?levelId=${level.id}&excludeId=${full}`)).data?.data ?? []
  check('"DEMO A Room" is offered as another group with room', offered.some((g) => g.id === room))

  // contact log + follow-ups
  const now = new Date().toISOString()
  const c1 = await sa.json('POST', '/api/contact-logs', { body: { studentId: s1.id, channel: 'CALL', reason: 'PAYMENT', summary: 'DEMO: asked about this month\'s invoice, will pay on Sunday.', followUpAt: now } })
  const c2 = await sa.json('POST', '/api/contact-logs', { body: { studentId: s2.id, channel: 'WHATSAPP', direction: 'IN', reason: 'ABSENCE', summary: 'DEMO: parent said the child was ill yesterday.', followUpAt: `${iso(-1)}T09:00:00.000Z` } })
  check('2 contacts logged (one follow-up today, one overdue)', c1.data?.success && c2.data?.success, c1.data?.error?.message ?? c2.data?.error?.message)

  // renewals: a group close to its last session
  const renew = await mkGroup(`DEMO A Renew ${run}`)
  const [r1, r2] = [await mkStudent('RenewYes'), await mkStudent('RenewNo')]
  for (const s of [r1, r2]) if (s?.id) await sa.json('POST', `/api/groups/${renew}/students`, { body: { studentId: s.id } })
  const g = (await sa.json('GET', `/api/groups/${renew}`)).data?.data
  const per = g?.ends?.sessionsPerCycle ?? 4
  const before = (await sa.json('GET', '/api/renewals/settings')).data?.data?.sessionsBefore ?? 2
  const toHold = Math.max(1, per - before)
  const enr = (g?.enrollments ?? []).map((e) => e.id)
  for (let i = toHold; i >= 1; i--) {
    await sa.json('POST', '/api/enrollment-attendance', { body: { classSectionId: renew, attendanceDate: iso(-i), records: enr.map((id) => ({ studentEnrollmentId: id, status: 'PRESENT' })) } })
  }
  await sa.json('POST', `/api/groups/${renew}/extra-sessions`, { body: { date: iso(1), time: '19:00', reason: 'DEMO make-up session' } })
  const rn = (await sa.json('GET', '/api/renewals')).data?.data
  const mine = rn?.groups?.find((x) => x.id === renew)
  check(`"DEMO A Renew": ${toHold} of ${per} sessions held → parents asked "continuing?"`, (mine?.students?.length ?? 0) === 2)
  const no = mine?.students?.find((x) => x.studentId === r2?.id)
  if (no) await sa.json('PATCH', `/api/renewals/${no.requestId}`, { body: { answer: 'NO', reason: 'TIME', note: 'DEMO: the time does not suit' } })
  const yes = mine?.students?.find((x) => x.studentId === r1?.id)
  if (yes) await sa.json('PATCH', `/api/renewals/${yes.requestId}`, { body: { answer: 'YES' } })
  check('one answered "continuing", one "not continuing (time)"', !!no && !!yes)

  console.log('  ↳ open: Groups → "DEMO A Full" (capacity + waiting + Other groups), "DEMO A Renew" (extra session, Advance cycle ticks)')
  console.log('  ↳ open: Follow-ups, Renewals, the student "Seat1-' + run + ' DEMO-TEST" (Contact with parents), Campuses → Open branch profile')
  console.log('  ↳ try yourself: add a holiday (Holidays page) on a day without real groups, then remove it')
}

async function phaseBDemo(sa, base, run, phone) {
  section('13. Demo data for phase B (wallets)')
  const campuses = list((await sa.json('GET', '/api/campuses')).data)
  const campus = campuses.find((c) => c.isActive !== false) ?? campuses[0]
  const levels = (await sa.json('GET', '/api/discounts/options')).data?.data?.levels ?? []
  const level = levels[0]
  if (!campus || !level) return bad('a branch and a level are needed')
  const year = new Date().getFullYear()
  const parentPhone = phone(60)
  let k = 61
  const mkStudent = async (first, guardianPhone) => (await sa.json('POST', '/api/students', {
    body: {
      firstName: `${first}-${run}`, lastName: 'DEMO-TEST', fullNameAr: `تجربة ${first}`, fatherName: 'Father Demo', fatherPhoneNumber: '', motherName: '',
      parentStatus: 'BOTH_ALIVE', dateOfBirth: '2015-05-10T00:00:00.000Z', gender: 'MALE', nationality: 'Egyptian', address: '12 Demo St Hurghada',
      city: 'Hurghada', phoneNumber: phone(k), emergencyContact: phone(k++), email: '', hasSiblingAtAcademy: false, campusId: campus.id,
      rollNumber: '', totalFeeAmount: 0, academicYear: `${year}-${year + 1}`, guardianFirstName: 'Demo Wallet Parent', guardianLastName: '',
      guardianPhone, guardianEmail: '', guardianRelationship: '',
    },
  })).data?.data
  const mkGroup = async (name, extra = {}) => (await sa.json('POST', '/api/groups', { body: { campusId: campus.id, className: name, sectionName: 'A', levelId: level.id, ...extra } })).data?.data?.id
  const bal = async (id) => Number((await sa.json('GET', `/api/students/${id}/wallet`)).data?.data?.balance ?? 0)
  const invoiceOf = async (studentId, groupId) => list((await sa.json('GET', `/api/fees?studentId=${studentId}&limit=20`)).data).find((i) => i.classSectionId === groupId && i.status !== 'CANCELLED')
  const money = (n) => `${Number(n).toLocaleString('en-US')} EGP`

  const full = await mkGroup(`DEMO B Wallet ${run}`)
  const inst = await mkGroup(`DEMO B Installments ${run}`, { installmentsAllowed: true })
  const [a, b] = [await mkStudent('WalletA', parentPhone), await mkStudent('WalletB', parentPhone)]
  check('demo groups + two siblings (same parent) created', full && inst && a?.id && b?.id)
  if (!full || !inst || !a?.id || !b?.id) return
  const min = Number((await sa.json('GET', `/api/students/${a.id}/wallet`)).data?.data?.minimumTopUp ?? 0)

  // 1) top-up in parts: the invoice waits, then is paid automatically
  await sa.json('POST', `/api/groups/${full}/students`, { body: { studentId: a.id } })
  const invA = await invoiceOf(a.id, full)
  const price = Number(invA?.totalAmount ?? 0)
  check(`WalletA has an invoice in "DEMO B Wallet" (${money(price)})`, !!invA && price > 0, 'the first level needs a price')
  if (!invA || price <= 0) return
  const half = Math.max(min, Math.ceil(price / 2))
  const t1 = await sa.json('POST', '/api/wallet/topups', { body: { studentId: a.id, amount: half, method: 'Cash', remarks: 'DEMO top-up' } })
  check(`staff top-up ${money(half)} → receipt ${t1.data?.data?.topUpNumber ?? '-'}`, t1.data?.success, t1.data?.error?.message)
  const w1 = (await invoiceOf(a.id, full))?.status
  check(`group without installments: not enough yet, invoice still ${w1}`, half >= price || w1 !== 'PAID')
  const rest = Math.max(min, price - half + 100)
  await sa.json('POST', '/api/wallet/topups', { body: { studentId: a.id, amount: rest, method: 'InstaPay', remarks: 'DEMO top-up 2' } })
  const w2 = (await invoiceOf(a.id, full))?.status
  check(`second top-up → invoice paid automatically from the wallet (${w2}), ${money(await bal(a.id))} left`, w2 === 'PAID')

  // 2) installments group: partial payment from the wallet
  await sa.json('POST', '/api/wallet/topups', { body: { studentId: b.id, amount: half, method: 'Cash', remarks: 'DEMO top-up' } })
  await sa.json('POST', `/api/groups/${inst}/students`, { body: { studentId: b.id } })
  const ib = await invoiceOf(b.id, inst)
  check(`installments allowed: WalletB's invoice paid from the wallet (${money(ib?.paidAmount ?? 0)} of ${money(ib?.totalAmount ?? 0)})`, ib?.status === 'PARTIALLY_PAID' || ib?.status === 'PAID', ib?.status)

  // 3) sibling transfer
  const before = await bal(a.id)
  if (before > 0) {
    const amt = Math.min(50, before)
    const tr = await sa.json('POST', `/api/students/${a.id}/wallet/transfer`, { body: { toStudentId: b.id, amount: amt } })
    check(`moved ${money(amt)} from WalletA to his brother`, tr.data?.success, tr.data?.error?.message)
  }

  // 4) parent: sees both wallets, uploads a receipt (waits in "Receipts to check"), asks for a withdrawal
  const guardianId = ((await sa.json('GET', `/api/students/${a.id}`)).data?.data?.guardians ?? [])[0]?.id
  const temp = await sa.json('POST', `/api/students/${a.id}/portal-password`, { body: { target: 'guardian', guardianId } })
  const parent = new Client(base)
  const signed = !!temp.data?.data?.password && (await parent.login(parentPhone, temp.data.data.password))
  check(`parent ${parentPhone} signs in (temporary password)`, signed)
  if (signed) {
    const pw = (await parent.json('GET', '/api/guardian-portal/wallet')).data?.data
    check(`parent sees both children's wallets (${(pw?.wallets ?? []).map((w) => money(w.balance)).join(' + ')})`, (pw?.wallets?.length ?? 0) === 2)
    const form = new FormData()
    form.append('studentId', b.id); form.append('amount', String(Math.max(min, 300))); form.append('remarks', 'DEMO transfer receipt')
    form.append('file', new Blob([PNG], { type: 'image/png' }), 'receipt.png')
    const up = await parent.json('POST', '/api/guardian-portal/wallet/topups', { multipart: form })
    check('parent uploaded a top-up receipt → waits in "Receipts to check"', up.status < 300, up.data?.error?.message)
    const payout = pw?.payoutMethods?.[0]
    const left = await bal(a.id)
    if (payout && left > 0) {
      const amt = Math.min(20, left)
      const wd = await parent.json('POST', '/api/guardian-portal/wallet/withdrawals', { body: { studentId: a.id, amount: amt, payoutMethod: payout } })
      check(`parent asked for ${money(amt)} back (${payout}) → waits in "Withdrawals"`, wd.data?.success, wd.data?.error?.message)
    }
  }
  const sum = (await sa.json('GET', '/api/wallet/summary')).data?.data
  check(`prepaid money in all wallets: ${money(sum?.prepaidTotal ?? 0)}`, sum?.prepaidTotal !== undefined)

  console.log('  ↳ open: Wallet & Top-ups → "Receipts to check" (approve the demo receipt) and "Withdrawals" (approve/reject)')
  console.log(`  ↳ open: the student "WalletA-${run} DEMO-TEST" → Wallet card (statement, top-up receipts), Fees → invoices paid from the wallet`)
  console.log(`  ↳ parent portal: phone ${parentPhone} (reset its portal password from the student page to sign in yourself)`)
}

async function phaseCDemo(sa, base, run, phone) {
  section('14. Demo data for phase C (excuses, attendance alerts, ratings, birthdays)')
  const iso = (k) => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() + k); return d.toISOString().slice(0, 10) }
  const campuses = list((await sa.json('GET', '/api/campuses')).data)
  const campus = campuses.find((c) => c.isActive !== false) ?? campuses[0]
  const levels = (await sa.json('GET', '/api/discounts/options')).data?.data?.levels ?? []
  const level = levels[0]
  if (!campus || !level) return bad('a branch and a level are needed')
  const year = new Date().getFullYear()
  const parentPhone = phone(70)
  // Birthdays are in Egypt time: between midnight and 2-3 AM Cairo the UTC date is still yesterday.
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  let k = 71
  const mkStudent = async (first, dob) => (await sa.json('POST', '/api/students', {
    body: {
      firstName: `${first}-${run}`, lastName: 'DEMO-TEST', fullNameAr: `تجربة ${first}`, fatherName: 'Father Demo', fatherPhoneNumber: '', motherName: '',
      parentStatus: 'BOTH_ALIVE', dateOfBirth: `${dob}T00:00:00.000Z`, gender: 'MALE', nationality: 'Egyptian', address: '12 Demo St Hurghada',
      city: 'Hurghada', phoneNumber: phone(k), emergencyContact: phone(k++), email: '', hasSiblingAtAcademy: false, campusId: campus.id,
      rollNumber: '', totalFeeAmount: 0, academicYear: `${year}-${year + 1}`, guardianFirstName: 'Demo C Parent', guardianLastName: '',
      guardianPhone: parentPhone, guardianEmail: '', guardianRelationship: '',
    },
  })).data?.data
  const group = (await sa.json('POST', '/api/groups', { body: { campusId: campus.id, className: `DEMO C Group ${run}`, sectionName: 'A', levelId: level.id } })).data?.data?.id
  // birthday today (age 9), a young child (5) and an older brother (12)
  const [bday, young, older] = [
    await mkStudent('Birthday', `${year - 9}${today.slice(4)}`),
    await mkStudent('Young', `${year - 5}-03-15`),
    await mkStudent('Older', `${year - 12}-06-20`),
  ]
  check('demo group + three brothers (birthday today, a 5-year-old, a 12-year-old)', group && bday?.id && young?.id && older?.id)
  if (!group || !bday?.id || !young?.id || !older?.id) return
  const allDays = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, time: '17:00' }))
  await sa.json('PATCH', `/api/groups/${group}`, { body: { scheduleSlots: allDays } })
  for (const s of [bday, young, older]) await sa.json('POST', `/api/groups/${group}/students`, { body: { studentId: s.id } })
  const g = (await sa.json('GET', `/api/groups/${group}`)).data?.data
  const enr = Object.fromEntries((g?.enrollments ?? []).map((e) => [e.studentId ?? e.student?.id, e.id]))
  const rec = (sid, status) => ({ studentEnrollmentId: enr[sid], status })
  // Only 2 sessions, so the month still has sessions ahead to excuse (short levels have few sessions a month).
  for (const [day, statuses] of [[-2, ['PRESENT', 'PRESENT', 'ABSENT']], [-1, ['LATE', 'PRESENT', 'ABSENT']]]) {
    await sa.json('POST', '/api/enrollment-attendance', { body: { classSectionId: group, attendanceDate: iso(day), records: [rec(bday.id, statuses[0]), rec(young.id, statuses[1]), rec(older.id, statuses[2])] } })
  }
  check('2 sessions recorded: "Older" absent twice in a row (alert + follow-up), "Birthday" late once', !!enr[older.id])

  const guardianId = ((await sa.json('GET', `/api/students/${bday.id}`)).data?.data?.guardians ?? [])[0]?.id
  const temp = await sa.json('POST', `/api/students/${bday.id}/portal-password`, { body: { target: 'guardian', guardianId } })
  const parent = new Client(base)
  const signed = !!temp.data?.data?.password && (await parent.login(parentPhone, temp.data.data.password))
  check(`parent ${parentPhone} signs in`, signed)
  if (signed) {
    // Pick a real upcoming session from the list the parent sees (not "tomorrow", which may be after the month's last session).
    const options = (await parent.json('GET', `/api/guardian-portal/excuses?studentId=${older.id}`)).data?.data?.sessions ?? []
    const next = options.find((o) => o.classSectionId === group && !o.past)
    if (!next) {
      bad('no upcoming session left this month to excuse (the level has few sessions per month)')
    } else {
      const ex = await parent.json('POST', '/api/guardian-portal/excuses', { body: { studentId: older.id, classSectionId: group, sessionDate: next.date, reason: 'DEMO: doctor appointment' } })
      check(`parent sent an excuse for the session on ${next.date} (${ex.data?.data?.status ?? '-'})`, ex.data?.success, ex.data?.error?.message)
    }
    const r = (await parent.json('GET', '/api/ratings/parent')).data?.data
    const ys = r?.children?.find((c) => c.studentId === young.id)?.sessions?.[0]
    if (ys) {
      const rt = await parent.json('POST', '/api/ratings/parent', { body: { type: 'session', studentId: young.id, classSectionId: group, sessionDate: ys.date, rating: 4 } })
      check('parent rated the 5-year-old\'s session 😀', rt.data?.success, rt.data?.error?.message)
    }
    const tl = (await parent.json('GET', `/api/students/${older.id}/attendance-timeline`)).data?.data
    check(`portal attendance for "Older": ${tl?.overall?.pct ?? '-'}%`, tl?.overall?.sessions === 2)
    const me = (await parent.json('GET', '/api/birthdays/me')).data?.data
    check('parent portal shows the birthday banner for "Birthday"', (me?.children ?? []).some((c) => c.studentId === bday.id))
  }
  const bd = (await sa.json('GET', '/api/birthdays?range=today&kind=STUDENT')).data?.data?.people ?? []
  check('Birthdays page lists "Birthday" today', bd.some((p) => p.id === bday.id))
  const ins = (await sa.json('GET', '/api/dashboard/insights')).data?.data?.metrics ?? []
  check(`dashboard numbers ready (${ins.length})`, ins.length > 0)

  console.log(`  ↳ open: Absence Excuses (the demo excuse), Follow-ups ("Older-${run}" absent twice), Birthdays (today), Ratings`)
  console.log(`  ↳ open: the student "Older-${run} DEMO-TEST" → Reports / attendance; Settings → Notifications to switch types on/off`)
  console.log(`  ↳ parent portal: phone ${parentPhone} (reset its portal password from the student page to sign in yourself)`)
}

async function demoLogins(sa, base, run, phone) {
  section('15. Demo accounts: instructor, student, parent')
  const iso = (k) => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() + k); return d.toISOString().slice(0, 10) }
  const campuses = list((await sa.json('GET', '/api/campuses')).data)
  const campus = campuses.find((c) => c.isActive !== false) ?? campuses[0]
  const levels = (await sa.json('GET', '/api/discounts/options')).data?.data?.levels ?? []
  const level = levels[0]
  if (!campus || !level) return bad('a branch and a level are needed')
  const year = new Date().getFullYear()

  // instructor (staff e-mail @demo.technova.local = removed by --cleanup)
  const teacherEmail = `teacher-${run}${'@demo.technova.local'}`
  const teacherPass = `Demo${run}Tt${randomInt(10, 99)}`
  const t = await sa.json('POST', '/api/teachers', {
    body: {
      firstName: 'Demo', lastName: `Instructor ${run}`, cnic: `29${run}${String(randomInt(1000000, 9999999))}`, dateOfBirth: '1995-04-12T00:00:00.000Z', gender: 'MALE',
      qualification: 'BSc', experienceYears: 2, joiningDate: new Date().toISOString(), designation: 'Instructor',
      phoneNumber: phone(90), email: teacherEmail, address: '12 Demo St Hurghada', city: 'Hurghada', emergencyContact: phone(91),
      campusId: campus.id, password: teacherPass,
    },
  })
  const teacherId = t.data?.data?.id ?? t.data?.data?.teacher?.id
  check('demo instructor created', !!teacherId, t.data?.error?.message)

  // group + student + parent
  const group = (await sa.json('POST', '/api/groups', { body: { campusId: campus.id, className: `DEMO Logins ${run}`, sectionName: 'A', levelId: level.id } })).data?.data?.id
  if (group) {
    await sa.json('PATCH', `/api/groups/${group}`, { body: { scheduleSlots: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, time: '17:00' })) } })
    if (teacherId) await sa.json('POST', `/api/groups/${group}/instructor`, { body: { teacherId } })
  }
  const parentPhone = phone(92)
  const s = (await sa.json('POST', '/api/students', {
    body: {
      firstName: `Login-${run}`, lastName: 'DEMO-TEST', fullNameAr: 'طالب تجربة', fatherName: 'Father Demo', fatherPhoneNumber: '', motherName: '',
      parentStatus: 'BOTH_ALIVE', dateOfBirth: '2014-05-10T00:00:00.000Z', gender: 'MALE', nationality: 'Egyptian', address: '12 Demo St Hurghada',
      city: 'Hurghada', phoneNumber: phone(93), emergencyContact: phone(93), email: '', hasSiblingAtAcademy: false, campusId: campus.id,
      rollNumber: '', totalFeeAmount: 0, academicYear: `${year}-${year + 1}`, guardianFirstName: 'Demo Login Parent', guardianLastName: '',
      guardianPhone: parentPhone, guardianEmail: '', guardianRelationship: '',
    },
  })).data?.data
  check('demo group, student and parent created', !!group && !!s?.id)
  if (!group || !s?.id) return
  await sa.json('POST', `/api/groups/${group}/students`, { body: { studentId: s.id } })
  const g = (await sa.json('GET', `/api/groups/${group}`)).data?.data
  const enr = (g?.enrollments ?? [])[0]?.id
  if (enr) {
    for (const [k, st] of [[-2, 'PRESENT'], [-1, 'LATE']]) await sa.json('POST', '/api/enrollment-attendance', { body: { classSectionId: group, attendanceDate: iso(k), records: [{ studentEnrollmentId: enr, status: st }] } })
  }
  const guardianId = ((await sa.json('GET', `/api/students/${s.id}`)).data?.data?.guardians ?? [])[0]?.id
  const pp = (await sa.json('POST', `/api/students/${s.id}/portal-password`, { body: { target: 'guardian', guardianId } })).data?.data
  const sp = (await sa.json('POST', `/api/students/${s.id}/portal-password`, { body: { target: 'student' } })).data?.data
  check('temporary passwords issued for the student and the parent', !!pp?.password && !!sp?.password)

  console.log(`\n  Sign in at ${base}/login  (write these down now — they are not saved anywhere)`)
  console.log('  ┌─────────────┬──────────────────────────────────────────┬──────────────────────┐')
  const row = (who, id, pw) => console.log(`  │ ${who.padEnd(11)} │ ${String(id).padEnd(40)} │ ${String(pw).padEnd(20)} │`)
  if (teacherId) row('Instructor', teacherEmail, teacherPass)
  if (pp?.password) row('Parent', pp.loginId ?? parentPhone, pp.password)
  if (sp?.password) row('Student', sp.loginId ?? '—', sp.password)
  console.log('  └─────────────┴──────────────────────────────────────────┴──────────────────────┘')
  console.log('  The parent and the student are asked to choose a new password at first sign-in.')
  console.log(`  The instructor sees the group "DEMO Logins ${run}" (2 sessions recorded, attendance, excuses, birthdays page).`)
}

async function phaseDDemo(sa, base, run, phone) {
  section('16. Demo data for phase D (referral + complaints)')
  const campuses = list((await sa.json('GET', '/api/campuses')).data)
  const campus = campuses.find((c) => c.isActive !== false) ?? campuses[0]
  const levels = (await sa.json('GET', '/api/discounts/options')).data?.data?.levels ?? []
  const level = levels[0]
  if (!campus || !level) return bad('a branch and a level are needed')
  const year = new Date().getFullYear()
  let k = 40
  const mkStudent = async (first, guardianFirst, guardianPhone, extra = {}) => (await sa.json('POST', '/api/students', {
    body: {
      firstName: `${first}-${run}`, lastName: 'DEMO-TEST', fullNameAr: `تجربة ${first}`, fatherName: 'Father Demo', fatherPhoneNumber: '', motherName: '',
      parentStatus: 'BOTH_ALIVE', dateOfBirth: '2015-05-10T00:00:00.000Z', gender: 'MALE', nationality: 'Egyptian', address: '12 Demo St Hurghada',
      city: 'Hurghada', phoneNumber: phone(k), emergencyContact: phone(k++), email: '', hasSiblingAtAcademy: false, campusId: campus.id,
      rollNumber: '', totalFeeAmount: 0, academicYear: `${year}-${year + 1}`, guardianFirstName: guardianFirst, guardianLastName: 'Demo',
      guardianPhone, guardianEmail: '', guardianRelationship: '', ...extra,
    },
  })).data?.data
  const settings = (await sa.json('GET', '/api/referrals/settings')).data?.data?.settings
  console.log(`  ↳ referral reward is ${settings?.rewardEnabled ? `ON (${settings.rewardAmount} EGP)` : 'OFF — switch it on in Referrals to see the wallet reward'}; welcome discount ${settings?.welcomeEnabled ? 'ON' : 'OFF'}`)

  // 1) the referring parent (has a child) and their code
  const referrerPhone = phone(41)
  const kid = await mkStudent('Referrer', 'Amira', referrerPhone)
  const group = (await sa.json('POST', '/api/groups', { body: { campusId: campus.id, className: `DEMO D Group ${run}`, sectionName: 'A', levelId: level.id } })).data?.data?.id
  check('demo group + the referring parent\'s child', !!group && !!kid?.id)
  if (!group || !kid?.id) return
  await sa.json('POST', `/api/groups/${group}/students`, { body: { studentId: kid.id } })
  const guardianId = ((await sa.json('GET', `/api/students/${kid.id}`)).data?.data?.guardians ?? [])[0]?.id
  const temp = (await sa.json('POST', `/api/students/${kid.id}/portal-password`, { body: { target: 'guardian', guardianId } })).data?.data
  const parent = new Client(base)
  const signed = !!temp?.password && (await parent.login(referrerPhone, temp.password))
  check(`referring parent ${referrerPhone} signs in`, signed)
  if (!signed) return
  const code = (await parent.json('GET', '/api/referrals/mine')).data?.data?.code
  check(`parent's referral code: ${code ?? '-'}`, !!code)

  // 2) a friend's child registers with the code, then pays the first invoice
  const friend = await mkStudent('Friend', 'Hoda', phone(43), { referralCode: code })
  const ref = (await sa.json('GET', `/api/referrals?studentId=${friend?.id}`)).data?.data
  check(`new student "Friend" linked to the code (${ref?.status ?? '-'})`, ref?.status === 'PENDING')
  await sa.json('POST', `/api/groups/${group}/students`, { body: { studentId: friend.id } })
  const inv = list((await sa.json('GET', `/api/fees?studentId=${friend.id}&limit=10`)).data).find((i) => i.classSectionId === group && i.status !== 'CANCELLED')
  if (inv && Number(inv.totalAmount) > 0) {
    const left = Number(inv.totalAmount) - Number(inv.paidAmount ?? 0)
    const pay = await sa.json('POST', `/api/fees/${inv.id}/payments`, { body: { amount: left, paymentMethod: 'Cash' } })
    check(`"Friend" paid the first invoice (${left} EGP)`, pay.data?.success, pay.data?.error?.message)
    const after = (await sa.json('GET', `/api/referrals?studentId=${friend.id}`)).data?.data
    check(`referral ${after?.status}${after?.reward ? ` — ${after.reward} EGP added to "Referrer"'s wallet` : ' (no reward: it is switched off)'}`, after?.status === 'REWARDED')
  } else {
    bad('no invoice for "Friend" (the first level needs a price)')
  }

  // 3) complaints: one solved end-to-end, one left for you to handle, one phone suggestion
  const c1 = (await parent.json('POST', '/api/complaints', { body: { kind: 'COMPLAINT', topic: 'SCHEDULE', body: 'DEMO: the session started 15 minutes late today', studentId: kid.id } })).data?.data
  check(`parent sent complaint ${c1?.number ?? '-'}`, !!c1?.id)
  if (c1?.id) {
    await sa.json('POST', `/api/complaints/${c1.id}`, { body: { body: 'DEMO: sorry! We spoke to the instructor; it will not happen again.' } })
    await sa.json('PATCH', `/api/complaints/${c1.id}`, { body: { status: 'RESOLVED' } })
    const ok = await parent.json('POST', `/api/complaints/${c1.id}/confirm`, { body: { satisfied: true, rating: 5 } })
    check('staff replied → solved → parent confirmed with 5 stars (closed)', ok.data?.success, ok.data?.error?.message)
  }
  const c2 = (await parent.json('POST', '/api/complaints', { body: { kind: 'COMPLAINT', topic: 'PAYMENT', body: 'DEMO: I paid by transfer but the invoice still shows unpaid', studentId: kid.id } })).data?.data
  check(`second complaint ${c2?.number ?? '-'} left NEW for you to handle`, !!c2?.id)
  const s1 = await sa.json('POST', '/api/complaints', { body: { studentId: kid.id, from: 'PARENT', kind: 'SUGGESTION', topic: 'SCHEDULE', body: 'DEMO: please open a Friday group' } })
  check('a phone suggestion recorded in the parent\'s name', s1.data?.success, s1.data?.error?.message)

  console.log(`\n  ↳ open: Complaints (queue: the demo complaint to reply to, the phone suggestion), Referrals (who referred whom)`)
  console.log(`  ↳ parent portal: phone ${referrerPhone}, temporary password ${temp.password} (asks for a new one at first sign-in)`)
  console.log('    → My Children: "Invite a friend" card with the code; Complaints: the 3 messages and their stages')
}

// ── LMS L1: curriculum library (2026-10-09) ────────────────────────────────
// Makes a DEMO curriculum version (notes start with "DEMO ") on one level and walks the whole flow:
// sessions, content of every kind (incl. a real private image upload), student preview, review, publish,
// copy, export / import, duplicate / remove session, course skill. Publishing is only tried on a level that has
// NO published curriculum yet, so your real curricula are never archived. Removed by --cleanup.
async function lmsDemo(sa, base, run) {
  section('17. LMS L1 — curriculum library')
  const tree = (await sa.json('GET', '/api/curriculum/tree')).data?.data?.tree ?? []
  const levels = tree.flatMap((t) => t.courses.flatMap((c) => c.levels.map((l) => ({ ...l, course: c.name, courseId: c.id }))))
  check(`curriculum tree opens (${levels.length} levels)`, levels.length > 0)
  if (!levels.length) return bad('no active levels — add one in Course Structure first')
  const level = levels.find((l) => !l.publishedNumber && !l.draftCount && !l.reviewCount) ?? levels[0]
  const canPublish = !level.publishedNumber
  console.log(`  ↳ using ${level.course} — ${level.name} (${level.numberOfSessions} sessions)${canPublish ? '' : ' — it already has a published curriculum, so publishing is skipped'}`)

  const created = await sa.json('POST', `/api/curriculum/levels/${level.id}`, { body: { notes: `DEMO version ${run}` } })
  const e1 = created.data?.data?.id
  check('new version = draft with one empty session per planned session', !!e1, created.data?.error?.message)
  if (!e1) return
  let ed = (await sa.json('GET', `/api/curriculum/editions/${e1}`)).data?.data
  check(`${ed?.sessions?.length} sessions created (status ${ed?.edition?.status})`, ed?.sessions?.length === level.numberOfSessions && ed?.edition?.status === 'DRAFT')
  const s1 = ed.sessions[0].id

  const patch = await sa.json('PATCH', `/api/curriculum/sessions/${s1}`, {
    body: { titleEn: `DEMO Meet the robot ${run}`, titleAr: 'تعرف على الروبوت (تجربة)', objectivesEn: '- Name the robot parts\n- Make it move', objectivesAr: '- يعرف أجزاء الروبوت\n- يحركه', materialsEn: 'Robot kit, laptop', instructorNotes: 'DEMO secret tip for the instructor', durationMin: 90 },
  })
  check('session texts saved (AR / EN, objectives, kit, instructor notes, duration)', patch.data?.success, patch.data?.error?.message)

  const add = (body) => sa.json('POST', `/api/curriculum/sessions/${s1}/blocks`, { body })
  check('text block (markdown)', (await add({ type: 'TEXT', data: { textEn: '## Welcome\nToday we build a **robot**.', textAr: '## أهلاً\nالنهارده هنبني **روبوت**.' } })).data?.success)
  check('YouTube video block', (await add({ type: 'VIDEO', titleEn: 'Intro video', data: { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' } })).data?.success)
  check('code block (instructor only)', (await add({ type: 'CODE', audience: 'INSTRUCTOR', titleEn: 'Solution', data: { language: 'python', code: 'print("hello robot")' } })).data?.success)
  check('link block', (await add({ type: 'LINK', titleEn: 'Robot parts', data: { url: 'https://www.tinkercad.com' } })).data?.success)
  check('embedded Scratch project', (await add({ type: 'EMBED', data: { url: 'https://scratch.mit.edu/projects/10128407/embed', height: 420 } })).data?.success)
  check('quiz placeholder (built in L4)', (await add({ type: 'QUIZ', data: { note: 'DEMO quiz later' } })).data?.success)
  check('embed from an unknown site is refused', (await add({ type: 'EMBED', data: { url: 'https://evil.example.com/x' } })).data?.success === false)
  check('javascript: link is refused', (await add({ type: 'LINK', data: { url: 'javascript:alert(1)' } })).data?.success === false)

  // real private upload to Cloudinary (tiny PNG) + signed link check
  const sign = (await sa.json('POST', '/api/curriculum/media/sign')).data?.data
  if (!sign?.signature) bad('upload signature', 'Cloudinary is not configured on the site')
  else {
    const fd = new FormData()
    fd.append('file', new Blob([PNG], { type: 'image/png' }), 'demo.png')
    for (const [k, v] of Object.entries({ api_key: sign.apiKey, timestamp: String(sign.timestamp), signature: sign.signature, folder: sign.folder, allowed_formats: sign.allowedFormats, type: sign.type })) fd.append(k, v)
    const up = await fetch(`https://api.cloudinary.com/v1_1/${sign.cloudName}/auto/upload`, { method: 'POST', body: fd })
    const j = await up.json().catch(() => ({}))
    check('image uploaded to Cloudinary as PRIVATE (authenticated)', up.ok && j.type === 'authenticated', j?.error?.message)
    if (up.ok) {
      const img = await add({ type: 'IMAGE', titleEn: 'The kit', data: { media: { publicId: j.public_id, resourceType: j.resource_type, format: j.format, bytes: j.bytes, originalName: 'demo.png' }, captionEn: 'DEMO picture' } })
      check('image block saved', img.data?.success, img.data?.error?.message)
      const plain = `https://res.cloudinary.com/${sign.cloudName}/image/authenticated/${j.public_id}.${j.format}`
      const direct = await fetch(plain)
      check('the file does NOT open without the signed link', !direct.ok, `status ${direct.status}`)
    }
  }

  let view = (await sa.json('GET', `/api/curriculum/sessions/${s1}`)).data?.data
  const imgBlock = view?.blocks?.find((b) => b.type === 'IMAGE')
  if (imgBlock) {
    const r = await fetch(imgBlock.data.mediaUrl)
    check('the signed link made by the site opens the image', r.ok, `status ${r.status}`)
  }
  const stu = (await sa.json('GET', `/api/curriculum/sessions/${s1}?as=STUDENT`)).data?.data
  check(`student preview hides instructor notes + instructor-only content (${view?.blocks?.length} → ${stu?.blocks?.length} items)`, stu && stu.session.instructorNotes === null && !stu.blocks.some((b) => b.audience === 'INSTRUCTOR') && stu.blocks.length === view.blocks.length - 1)

  const ids = view.blocks.map((b) => b.id)
  const reordered = await sa.json('PUT', `/api/curriculum/sessions/${s1}/blocks`, { body: { ids: [...ids].reverse() } })
  view = (await sa.json('GET', `/api/curriculum/sessions/${s1}`)).data?.data
  check('content reordered', reordered.data?.success && view.blocks[0].id === ids[ids.length - 1])

  const dup = await sa.json('POST', `/api/curriculum/sessions/${s1}`)
  ed = (await sa.json('GET', `/api/curriculum/editions/${e1}`)).data?.data
  check('session duplicated right after itself', dup.data?.success && ed.sessions[1]?.id === dup.data?.data?.id && ed.sessions.length === level.numberOfSessions + 1)
  const rm = await sa.json('DELETE', `/api/curriculum/sessions/${dup.data?.data?.id}`)
  ed = (await sa.json('GET', `/api/curriculum/editions/${e1}`)).data?.data
  check('session removed, the rest renumbered', rm.data?.success && ed.sessions.map((x) => x.number).join(',') === ed.sessions.map((_, i) => i + 1).join(','))

  const early = await sa.json('PATCH', `/api/curriculum/editions/${e1}`, { body: { action: 'submit' } })
  check('send for review refused while some sessions have no title', early.data?.error?.code === 'INCOMPLETE', early.data?.error?.message)
  for (const x of ed.sessions.slice(1)) await sa.json('PATCH', `/api/curriculum/sessions/${x.id}`, { body: { titleEn: `DEMO Lesson ${x.number}`, titleAr: `درس ${x.number} (تجربة)` } })
  const sub = await sa.json('PATCH', `/api/curriculum/editions/${e1}`, { body: { action: 'submit' } })
  check('sent for review', sub.data?.data?.status === 'IN_REVIEW', sub.data?.error?.message)
  const locked = await sa.json('PATCH', `/api/curriculum/sessions/${s1}`, { body: { titleEn: 'x' } })
  check('a version in review cannot be edited', locked.data?.error?.code === 'LOCKED')
  check('review comment added', (await sa.json('POST', `/api/curriculum/sessions/${s1}/comments`, { body: { body: 'DEMO: please add a picture of the wiring' } })).data?.success)

  if (canPublish) {
    const pub = await sa.json('PATCH', `/api/curriculum/editions/${e1}`, { body: { action: 'publish' } })
    check('published', pub.data?.data?.status === 'PUBLISHED', pub.data?.error?.message)
    check('a published version cannot be deleted', (await sa.json('DELETE', `/api/curriculum/editions/${e1}`)).data?.success === false)
  } else {
    const back = await sa.json('PATCH', `/api/curriculum/editions/${e1}`, { body: { action: 'reject' } })
    check('sent back to draft by the reviewer', back.data?.data?.status === 'DRAFT', back.data?.error?.message)
  }

  const copy = await sa.json('POST', `/api/curriculum/levels/${level.id}`, { body: { copyFromId: e1, notes: `DEMO copy ${run}` } })
  const e2 = copy.data?.data?.id
  const ed2 = e2 ? (await sa.json('GET', `/api/curriculum/editions/${e2}`)).data?.data : null
  check('new version copied from the first one (same sessions + content)', ed2?.sessions?.length === ed.sessions.length && ed2.sessions[0].blockCount === view.blocks.length)

  const exp = await sa.raw('GET', `/api/curriculum/editions/${e1}/export`)
  const file = await exp.json().catch(() => null)
  check(`export file downloaded (${file?.sessions?.length} sessions)`, file?.format === 'technova-curriculum-v1')
  if (file) {
    file.notes = `DEMO import ${run}`
    const imp = await sa.json('POST', `/api/curriculum/levels/${level.id}/import`, { body: file })
    check('import → a new draft', imp.data?.success, imp.data?.error?.message)
  }
  check('not-a-curriculum file is refused', (await sa.json('POST', `/api/curriculum/levels/${level.id}/import`, { body: { format: 'x', sessions: [] } })).data?.success === false)

  const skill = await sa.json('POST', '/api/curriculum/skills', { body: { subjectId: level.courseId, nameEn: `DEMO Sensors ${run}`, nameAr: 'حساسات (تجربة)' } })
  check('course skill added', skill.data?.success, skill.data?.error?.message)
  if (skill.data?.data?.id) {
    const tag = await sa.json('PATCH', `/api/curriculum/sessions/${ed2?.sessions?.[0]?.id}`, { body: { skillIds: [skill.data.data.id] } })
    check('skill tagged on a lesson', tag.data?.success, tag.data?.error?.message)
  }

  const anon = await fetch(`${base}/api/curriculum/tree`)
  check('not signed in → curriculum refused', anon.status === 401, `status ${anon.status}`)

  console.log(`  ↳ open Curriculum → ${level.course} → ${level.name}: versions "DEMO …" (v${ed.edition.number}${e2 ? ` + copy` : ''} + import).`)
  console.log('  ↳ open session 1 → try "Preview as a student" and "Instructor view"; the copy is a draft you can edit.')
}

function finish() {
  rl.close()
  console.log(`\nRESULT: ${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
