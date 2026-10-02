import { describe, expect, it, beforeAll } from 'vitest'
import { createHmac } from 'crypto'
import { paymobHmacString, signPaymob, verifyPaymobHmac, type PaymobTransaction } from '@/lib/payments/paymob'

const tx: PaymobTransaction = {
  id: 192036465,
  amount_cents: 62250,
  created_at: '2026-10-03T10:00:00.000000',
  currency: 'EGP',
  error_occured: false,
  has_parent_transaction: false,
  integration_id: 4512345,
  is_3d_secure: true,
  is_auth: false,
  is_capture: false,
  is_refunded: false,
  is_standalone_payment: true,
  is_voided: false,
  order: { id: 217503754, merchant_order_id: 'op-1' },
  owner: 1700,
  pending: false,
  source_data: { pan: '2346', sub_type: 'MasterCard', type: 'card' },
  success: true,
}

beforeAll(() => { process.env.PAYMOB_HMAC_SECRET = 'unit-test-secret' })

describe('Paymob webhook signature', () => {
  it('concatenates the signed fields in Paymob order', () => {
    expect(paymobHmacString(tx)).toBe(
      '622502026-10-03T10:00:00.000000EGPfalsefalse1920364654512345truefalsefalsefalsetruefalse2175037541700false2346MasterCardcardtrue'
    )
  })
  it('signs with HMAC-SHA512 of that string', () => {
    const expected = createHmac('sha512', 'unit-test-secret').update(paymobHmacString(tx)).digest('hex')
    expect(signPaymob(tx)).toBe(expected)
  })
  it('accepts a correct signature (case-insensitive)', () => {
    expect(verifyPaymobHmac(tx, signPaymob(tx))).toBe(true)
    expect(verifyPaymobHmac(tx, signPaymob(tx).toUpperCase())).toBe(true)
  })
  it('rejects a changed amount', () => {
    expect(verifyPaymobHmac({ ...tx, amount_cents: 100 }, signPaymob(tx))).toBe(false)
  })
  it('rejects a changed success flag', () => {
    expect(verifyPaymobHmac({ ...tx, success: false }, signPaymob(tx))).toBe(false)
  })
  it('rejects a missing or wrong signature', () => {
    expect(verifyPaymobHmac(tx, null)).toBe(false)
    expect(verifyPaymobHmac(tx, 'deadbeef')).toBe(false)
  })
  it('rejects everything when no secret is configured', () => {
    const saved = process.env.PAYMOB_HMAC_SECRET
    delete process.env.PAYMOB_HMAC_SECRET
    expect(verifyPaymobHmac(tx, 'x')).toBe(false)
    process.env.PAYMOB_HMAC_SECRET = saved
  })
})
