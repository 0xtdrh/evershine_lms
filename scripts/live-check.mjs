#!/usr/bin/env node
/**
 * Live check + demo data for TechNova (runs against the REAL site).
 *
 *   node scripts/live-check.mjs            # run the checks, leave demo data to explore
 *   node scripts/live-check.mjs --cleanup  # remove ONLY the demo data
 *   node scripts/live-check.mjs --transfer # only try moving students between groups (2026-10-03)
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
  console.log('TechNova live check' + (cleanupOnly ? ' — remove demo data' : transferOnly ? ' — moving students between groups' : ''))
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

function finish() {
  rl.close()
  console.log(`\nRESULT: ${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
