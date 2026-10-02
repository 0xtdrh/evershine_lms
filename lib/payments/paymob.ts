/**
 * Online payment through Paymob (Egypt). Server-only.
 *
 * Switched ON only when these environment variables exist on the host
 * (Vercel / Hostinger), from the owner's Paymob dashboard:
 *   PAYMOB_SECRET_KEY        sk_test_… / sk_live_…   (Settings > Account info)
 *   PAYMOB_PUBLIC_KEY        pk_test_… / pk_live_…
 *   PAYMOB_HMAC_SECRET       HMAC secret (Settings > Account info)
 *   PAYMOB_INTEGRATION_IDS   comma-separated integration ids (card, wallet…)
 *   PAYMOB_BASE_URL          optional, default https://accept.paymob.com
 * In the Paymob dashboard set the "Transaction processed callback" to
 *   https://<site>/api/webhooks/paymob
 *
 * Flow: parent presses "Pay online" -> we create an OnlinePayment (PENDING)
 * and a Paymob payment intention -> parent pays on Paymob's checkout page ->
 * Paymob calls our webhook (HMAC-signed) -> we verify the signature and the
 * amount, then record the FeePayment through recordPayment (source ONLINE).
 * The redirect back to the site never records anything by itself.
 */

import { createHmac, timingSafeEqual } from 'crypto'

const env = (k: string) => process.env[k]?.trim() || ''
export const PAYMOB_METHOD = 'Online (Paymob)'

export function isPaymobConfigured(): boolean {
  return !!(env('PAYMOB_SECRET_KEY') && env('PAYMOB_PUBLIC_KEY') && env('PAYMOB_HMAC_SECRET') && integrationIds().length)
}

function integrationIds(): number[] {
  return env('PAYMOB_INTEGRATION_IDS').split(',').map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0)
}

const base = () => (env('PAYMOB_BASE_URL') || 'https://accept.paymob.com').replace(/\/+$/, '')

export interface IntentionInput {
  reference: string // our OnlinePayment id
  amountEgp: number
  description: string
  customer: { firstName: string; lastName: string; phone: string; email?: string | null }
  notificationUrl: string
  redirectionUrl: string
}

/** Creates a Paymob payment intention and returns the hosted checkout URL. */
export async function createPaymobCheckout(input: IntentionInput): Promise<{ checkoutUrl: string; providerOrderId: string | null }> {
  const amountCents = Math.round(input.amountEgp * 100)
  const res = await fetch(`${base()}/v1/intention/`, {
    method: 'POST',
    headers: { authorization: `Token ${env('PAYMOB_SECRET_KEY')}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      amount: amountCents,
      currency: 'EGP',
      payment_methods: integrationIds(),
      items: [{ name: input.description.slice(0, 50), amount: amountCents, description: input.description.slice(0, 250), quantity: 1 }],
      billing_data: {
        first_name: input.customer.firstName || 'Parent',
        last_name: input.customer.lastName || 'TechNova',
        phone_number: input.customer.phone || 'NA',
        email: input.customer.email || 'no-email@technova.local',
        apartment: 'NA', floor: 'NA', street: 'NA', building: 'NA', city: 'Hurghada', country: 'EG', state: 'Red Sea', postal_code: 'NA',
      },
      special_reference: input.reference,
      notification_url: input.notificationUrl,
      redirection_url: input.redirectionUrl,
    }),
  })
  const data = (await res.json().catch(() => null)) as { client_secret?: string; intention_order_id?: number | string; detail?: string } | null
  if (!res.ok || !data?.client_secret) {
    throw new Error(`Paymob refused the payment request${data?.detail ? `: ${data.detail}` : ''}`)
  }
  const checkoutUrl = `${base()}/unifiedcheckout/?publicKey=${encodeURIComponent(env('PAYMOB_PUBLIC_KEY'))}&clientSecret=${encodeURIComponent(data.client_secret)}`
  return { checkoutUrl, providerOrderId: data.intention_order_id != null ? String(data.intention_order_id) : null }
}

// ── webhook signature ───────────────────────────────────────────────────────
/** Paymob "transaction processed" callback object (fields used here). */
export interface PaymobTransaction {
  id: number | string
  amount_cents: number
  created_at: string
  currency: string
  error_occured: boolean
  has_parent_transaction: boolean
  integration_id: number
  is_3d_secure: boolean
  is_auth: boolean
  is_capture: boolean
  is_refunded: boolean
  is_standalone_payment: boolean
  is_voided: boolean
  order: { id: number | string; merchant_order_id?: string | null }
  owner: number
  pending: boolean
  source_data: { pan?: string; sub_type?: string; type?: string }
  success: boolean
}

/** The fields Paymob signs, in Paymob's documented order. */
export function paymobHmacString(t: PaymobTransaction): string {
  const v = (x: unknown) => (x === undefined || x === null ? '' : String(x))
  return [
    t.amount_cents, t.created_at, t.currency, t.error_occured, t.has_parent_transaction, t.id, t.integration_id,
    t.is_3d_secure, t.is_auth, t.is_capture, t.is_refunded, t.is_standalone_payment, t.is_voided, t.order?.id,
    t.owner, t.pending, t.source_data?.pan, t.source_data?.sub_type, t.source_data?.type, t.success,
  ].map(v).join('')
}

export function signPaymob(t: PaymobTransaction, secret = env('PAYMOB_HMAC_SECRET')): string {
  return createHmac('sha512', secret).update(paymobHmacString(t)).digest('hex')
}

/** True if the callback really comes from Paymob (constant-time compare). */
export function verifyPaymobHmac(t: PaymobTransaction, hmac: string | null): boolean {
  const secret = env('PAYMOB_HMAC_SECRET')
  if (!secret || !hmac) return false
  const expected = Buffer.from(signPaymob(t, secret), 'utf8')
  const given = Buffer.from(hmac.toLowerCase(), 'utf8')
  return expected.length === given.length && timingSafeEqual(expected, given)
}
