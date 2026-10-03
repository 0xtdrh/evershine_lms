/**
 * Payment receipts. Server-only.
 * One receipt per FeePayment (number TN-RCPT-YYYY-NNNNN, see record-payment.ts).
 */

import { prisma } from '@/lib/prisma'
import { checkPermission } from '@/lib/rbac'
import { getFinanceSettings, type FinanceSettings } from '@/lib/fees/payment-settings'

export interface ReceiptData {
  paymentId: string
  receiptNumber: string
  paidAt: string
  amount: number
  method: string
  transactionId: string | null
  source: string | null
  status: string
  receivedBy: string
  student: { id: string; name: string; registrationNumber: string }
  parent: { name: string; phone: string } | null
  invoice: {
    id: string
    number: string
    month: string
    subtotal: number
    discount: number
    total: number
    paidSoFar: number
    remaining: number
    group: string | null
    course: string | null
    level: string | null
  }
  company: Pick<FinanceSettings, 'companyName' | 'companyPhone' | 'companyAddress' | 'receiptFooter' | 'receiptPaper'>
}

const round2 = (n: number) => Math.round(n * 100) / 100

/** Can this user see this payment's receipt? Staff with fee access, or the student / their parent. */
export async function canViewReceipt(user: { id: string; role: string }, studentId: string): Promise<boolean> {
  const role = user.role
  if (checkPermission(role as never, 'fees', 'read') && !['STUDENT', 'PARENT', 'GUARDIAN'].includes(role)) return true
  if (checkPermission(role as never, 'fee_collection', 'read')) return true
  if (role === 'STUDENT') {
    const s = await prisma.student.findUnique({ where: { userId: user.id }, select: { id: true } })
    return s?.id === studentId
  }
  if (role === 'PARENT' || role === 'GUARDIAN') {
    const linked = await prisma.student.findFirst({
      where: { id: studentId, OR: [{ parents: { some: { userId: user.id } } }, { guardians: { some: { userId: user.id } } }] },
      select: { id: true },
    })
    return !!linked
  }
  return false
}

export async function buildReceipt(paymentId: string): Promise<ReceiptData | null> {
  const p = await prisma.feePayment.findUnique({
    where: { id: paymentId },
    include: {
      invoice: {
        include: {
          classSection: { select: { className: true, sectionName: true } },
          level: { select: { name: true, subject: { select: { name: true } } } },
        },
      },
      student: {
        select: {
          id: true, firstName: true, lastName: true, registrationNumber: true,
          guardians: { select: { firstName: true, lastName: true, phoneNumber: true }, take: 1 },
        },
      },
    },
  })
  if (!p) return null
  const [settings, receiver, paidUpTo] = await Promise.all([
    getFinanceSettings(),
    prisma.user.findUnique({
      where: { id: p.receivedBy },
      select: {
        email: true, displayName: true,
        admin: { select: { firstName: true, lastName: true } },
        accountant: { select: { firstName: true, lastName: true } },
        secretary: { select: { firstName: true, lastName: true } },
        branchManager: { select: { firstName: true, lastName: true } },
      },
    }),
    // Paid on this invoice up to and including this payment (receipt shows the balance at that moment).
    prisma.feePayment.aggregate({
      where: { invoiceId: p.invoiceId, status: 'COMPLETED', createdAt: { lte: p.createdAt } },
      _sum: { amount: true },
    }),
  ])
  const prof = receiver?.admin ?? receiver?.accountant ?? receiver?.secretary ?? receiver?.branchManager
  const g = p.student.guardians[0]
  const total = Number(p.invoice.totalAmount)
  const paidSoFar = Number(paidUpTo._sum.amount ?? 0)
  return {
    paymentId: p.id,
    receiptNumber: p.receiptNumber ?? `PAY-${p.id.slice(-8).toUpperCase()}`,
    paidAt: p.paymentDate.toISOString(),
    amount: Number(p.amount),
    method: p.paymentMethod,
    transactionId: p.transactionId,
    source: p.source,
    status: p.status,
    receivedBy: prof ? `${prof.firstName} ${prof.lastName}` : receiver?.displayName || receiver?.email || '—',
    student: { id: p.student.id, name: `${p.student.firstName} ${p.student.lastName}`.trim(), registrationNumber: p.student.registrationNumber },
    parent: g ? { name: `${g.firstName} ${g.lastName}`.trim(), phone: g.phoneNumber } : null,
    invoice: {
      id: p.invoice.id,
      number: p.invoice.challanNumber,
      month: p.invoice.month,
      subtotal: Number(p.invoice.subtotal),
      discount: Number(p.invoice.discount),
      total,
      paidSoFar: round2(paidSoFar),
      remaining: round2(Math.max(0, total - paidSoFar)),
      group: p.invoice.classSection ? `${p.invoice.classSection.className} ${p.invoice.classSection.sectionName}`.trim() : null,
      course: p.invoice.level?.subject?.name ?? null,
      level: p.invoice.level?.name ?? null,
    },
    company: {
      companyName: settings.companyName,
      companyPhone: settings.companyPhone,
      companyAddress: settings.companyAddress,
      receiptFooter: settings.receiptFooter,
      receiptPaper: settings.receiptPaper,
    },
  }
}

/** Plain-text receipt for WhatsApp (Arabic, matches the printed one). */
export function receiptText(r: ReceiptData): string {
  const money = (n: number) => `${n.toLocaleString('en-US')} جنيه`
  return [
    `${r.company.companyName} — إيصال استلام`,
    `رقم الإيصال: ${r.receiptNumber}`,
    `التاريخ: ${new Date(r.paidAt).toLocaleDateString('en-GB')}`,
    `الطالب/ة: ${r.student.name} (${r.student.registrationNumber})`,
    r.invoice.group ? `الجروب: ${r.invoice.group}${r.invoice.course ? ` — ${r.invoice.course}` : ''}${r.invoice.level ? ` — ${r.invoice.level}` : ''}` : null,
    `الفاتورة: ${r.invoice.number} (${r.invoice.month})`,
    `المبلغ المدفوع: ${money(r.amount)} — ${r.method}`,
    `المتبقي على الفاتورة: ${money(r.invoice.remaining)}`,
    r.company.receiptFooter || null,
  ].filter(Boolean).join('\n')
}

/**
 * After a payment: send the receipt on WhatsApp automatically when the owner
 * switched it on AND the WhatsApp Business API is configured. Never throws.
 */
export async function afterPaymentRecorded(paymentId: string): Promise<void> {
  try {
    const settings = await getFinanceSettings()
    if (!settings.autoSendReceiptWhatsApp) return
    const { isAutoWhatsAppConfigured, sendWhatsAppText } = await import('@/lib/messaging/whatsapp')
    if (!isAutoWhatsAppConfigured()) return
    const r = await buildReceipt(paymentId)
    if (r?.parent?.phone) {
      await sendWhatsAppText(r.parent.phone, receiptText(r))
      // Phase A: also in the student's contact log.
      const { logSystemContact } = await import('@/lib/contacts/contact-log')
      await logSystemContact({ studentId: r.student.id, channel: 'WHATSAPP', reason: 'PAYMENT', summary: `Payment receipt ${r.receiptNumber} sent automatically on WhatsApp.` })
    }
  } catch (err) {
    console.error('[RECEIPT_AUTO_SEND]', err)
  }
}
