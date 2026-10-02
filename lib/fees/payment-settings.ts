/**
 * Payment settings (Settings > Payments). Server-only.
 *  - payment accounts parents transfer to (shown on invoices / parent portal)
 *  - payment methods staff pick when recording a payment
 *  - invoice due days
 *
 * WHY: invoices used to print the template's hard-coded Pakistani bank account
 * ("Ali Aslam", Easypaisa, Meezan Bank). Everything now comes from here.
 * Future online payment: add a PaymentAccount with kind ONLINE_GATEWAY.
 */

import { prisma } from '@/lib/prisma'
import { getSetting, setSetting } from '@/lib/settings/app-settings'
import { accountRows, type PublicPaymentAccount } from '@/lib/fees/payment-details'

export const ACCOUNT_KINDS = ['INSTAPAY', 'VODAFONE_CASH', 'BANK', 'FAWRY', 'ONLINE_GATEWAY', 'OTHER'] as const
export type AccountKind = (typeof ACCOUNT_KINDS)[number]

/** Method recorded automatically when an uploaded transfer proof is approved. */
export const PROOF_METHOD = 'Bank Transfer'

/** Created the first time the list is read (all editable except system ones). */
const DEFAULT_METHODS: { name: string; isSystem?: boolean }[] = [
  { name: 'Cash', isSystem: true },
  { name: 'InstaPay' },
  { name: 'Vodafone Cash' },
  { name: PROOF_METHOD, isSystem: true },
  { name: 'Fawry' },
  { name: 'Cheque' },
]

export async function listPaymentMethods(activeOnly = false) {
  const count = await prisma.paymentMethod.count()
  if (count === 0) {
    await prisma.paymentMethod.createMany({
      data: DEFAULT_METHODS.map((m, i) => ({ name: m.name, isSystem: !!m.isSystem, sortOrder: i })),
      skipDuplicates: true,
    })
  }
  return prisma.paymentMethod.findMany({
    where: activeOnly ? { isActive: true } : undefined,
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  })
}

/** True if `name` is an active payment method (used by every payment endpoint). */
export async function isActivePaymentMethod(name: string): Promise<boolean> {
  const methods = await listPaymentMethods(true)
  return methods.some((m) => m.name === name)
}

export async function listPaymentAccounts(activeOnly = false) {
  return prisma.paymentAccount.findMany({
    where: activeOnly ? { isActive: true } : undefined,
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  })
}

/** What parents may see (no internal ids/flags beyond what is needed). */
export async function publicPaymentAccounts(): Promise<PublicPaymentAccount[]> {
  const rows = await listPaymentAccounts(true)
  return rows.map((a) => ({
    kind: a.kind,
    label: a.label,
    accountName: a.accountName,
    accountNumber: a.accountNumber,
    bankName: a.bankName,
    iban: a.iban,
    instructions: a.instructions,
  }))
}

/** Text snapshot stored on each new invoice (audit: what the parent was shown). */
export async function paymentAccountsSnapshot(): Promise<string | null> {
  const rows = (await publicPaymentAccounts()).flatMap(accountRows)
  return rows.length ? rows.map((r) => `${r.label}: ${r.value}`).join('\n') : null
}

export type ReceiptPaper = '80mm' | '58mm' | 'A4'
export interface FinanceSettings {
  /** A new group invoice is due this many days after it is issued. */
  invoiceDueDays: number
  /** Receipt paper: thermal 80mm / 58mm, or a normal A4 printer. */
  receiptPaper: ReceiptPaper
  /** After staff record a payment: open the receipt, open it and print, or nothing. */
  receiptAfterPayment: 'OPEN' | 'PRINT' | 'NONE'
  /** Printed at the top / bottom of every receipt. */
  companyName: string
  companyPhone: string
  companyAddress: string
  receiptFooter: string
  /** Send receipts on WhatsApp automatically (needs WhatsApp Business API; see lib/messaging/whatsapp.ts). */
  autoSendReceiptWhatsApp: boolean
}
export const FINANCE_DEFAULTS: FinanceSettings = {
  invoiceDueDays: 7,
  receiptPaper: '80mm',
  receiptAfterPayment: 'OPEN',
  companyName: 'TechNova',
  companyPhone: '',
  companyAddress: 'Hurghada',
  receiptFooter: 'Thank you!',
  autoSendReceiptWhatsApp: false,
}

export function getFinanceSettings() {
  return getSetting<FinanceSettings>('finance.settings', FINANCE_DEFAULTS)
}

export function saveFinanceSettings(value: FinanceSettings, userId: string) {
  return setSetting('finance.settings', value, userId)
}

export async function invoiceDueDate(from = new Date()): Promise<Date> {
  const { invoiceDueDays } = await getFinanceSettings()
  const days = Number.isFinite(invoiceDueDays) && invoiceDueDays >= 0 ? invoiceDueDays : FINANCE_DEFAULTS.invoiceDueDays
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000)
}
