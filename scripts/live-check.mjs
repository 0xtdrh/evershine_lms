#!/usr/bin/env node
/**
 * Live check + demo data for TechNova (runs against the REAL site).
 *
 *   node scripts/live-check.mjs            # run the checks, leave demo data to explore
 *   node scripts/live-check.mjs --cleanup  # remove ONLY the demo data
 *   node scripts/live-check.mjs --transfer # only try moving students between groups (2026-10-03)
 *   node scripts/live-check.mjs --schedule # only make demo data for the Groups calendar (2026-10-03)
 *   node scripts/live-check.mjs --phase-a  # demo data for phase A: capacity/waiting, contact log, renewals
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
  console.log('TechNova live check' + (cleanupOnly ? ' — remove demo data' : transferOnly ? ' — moving students between groups' : scheduleOnly ? ' — demo data for the Groups calendar' : phaseAOnly ? ' — demo data for phase A' : ''))
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

function finish() {
  rl.close()
  console.log(`\nRESULT: ${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
