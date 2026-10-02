/**
 * Payment instructions shown on invoices (client-safe helpers).
 *
 * The accounts themselves are edited in Settings > Payments and read on the
 * server by lib/fees/payment-settings.ts. Invoices carry a text snapshot
 * ("Label: value" per line) which these helpers turn into table rows.
 *
 * (The template's hard-coded Pakistani bank account that used to live here
 * was removed on 2026-10-02: parents must only ever see TechNova's accounts.)
 */

export interface PaymentDetailRow {
  label: string
  value: string
}

export interface PublicPaymentAccount {
  kind: string
  label: string
  accountName: string | null
  accountNumber: string | null
  bankName: string | null
  iban: string | null
  instructions: string | null
}

const KIND_NAMES: Record<string, string> = {
  INSTAPAY: 'InstaPay',
  VODAFONE_CASH: 'Vodafone Cash',
  BANK: 'Bank',
  FAWRY: 'Fawry',
  ONLINE_GATEWAY: 'Online payment',
  OTHER: 'Payment',
}

/** Rows describing one account, e.g. "InstaPay — Main: 0100…", "Account name: …". */
export function accountRows(a: PublicPaymentAccount): PaymentDetailRow[] {
  const title = a.label?.trim() || KIND_NAMES[a.kind] || 'Payment'
  const rows: PaymentDetailRow[] = []
  if (a.accountNumber) rows.push({ label: title, value: a.accountNumber })
  else rows.push({ label: title, value: a.instructions ?? '' })
  if (a.accountName) rows.push({ label: `${title} - account name`, value: a.accountName })
  if (a.bankName) rows.push({ label: `${title} - bank`, value: a.bankName })
  if (a.iban) rows.push({ label: `${title} - IBAN`, value: a.iban })
  if (a.accountNumber && a.instructions) rows.push({ label: `${title} - note`, value: a.instructions })
  return rows.filter((r) => r.value)
}

/** Parses a "Label: value" per line snapshot. */
export function parsePaymentDetails(value?: string | null): PaymentDetailRow[] {
  if (!value?.trim()) return []
  return value
    .split(/\r?\n|;/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const separator = line.indexOf(':')
      if (separator < 0) return { label: 'Payment instruction', value: line }
      return { label: line.slice(0, separator).trim(), value: line.slice(separator + 1).trim() }
    })
}

/** Rows to render; empty when no payment account is configured (UI says "pay at the branch"). */
export function paymentDetailsRowsFromSnapshot(snapshot?: string | null): PaymentDetailRow[] {
  return parsePaymentDetails(snapshot)
}
