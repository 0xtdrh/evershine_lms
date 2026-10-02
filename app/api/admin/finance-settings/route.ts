/**
 * GET /api/admin/finance-settings — payment accounts, payment methods, invoice due days
 * PUT /api/admin/finance-settings — saves all three (lists are replaced as sent)
 *
 * Permission: finance_settings (read / update), Permissions page.
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import type { Role } from '@prisma/client'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { checkPermission } from '@/lib/rbac'
import { errors, successResponse } from '@/lib/api-response'
import { logAudit } from '@/lib/audit-logger'
import {
  ACCOUNT_KINDS,
  getFinanceSettings,
  listPaymentAccounts,
  listPaymentMethods,
  saveFinanceSettings,
} from '@/lib/fees/payment-settings'
import { isAutoWhatsAppConfigured } from '@/lib/messaging/whatsapp'

export const dynamic = 'force-dynamic'

const text = (max: number) => z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null))

const bodySchema = z.object({
  finance: z.object({
    invoiceDueDays: z.number().int().min(0).max(90),
    receiptPaper: z.enum(['80mm', '58mm', 'A4']).default('80mm'),
    receiptAfterPayment: z.enum(['OPEN', 'PRINT', 'NONE']).default('OPEN'),
    companyName: z.string().trim().max(80).default('TechNova'),
    companyPhone: z.string().trim().max(40).default(''),
    companyAddress: z.string().trim().max(160).default(''),
    receiptFooter: z.string().trim().max(200).default(''),
    autoSendReceiptWhatsApp: z.boolean().default(false),
  }),
  accounts: z
    .array(
      z.object({
        id: z.string().optional(),
        kind: z.enum(ACCOUNT_KINDS),
        label: z.string().trim().min(1).max(80),
        accountName: text(120),
        accountNumber: text(120),
        bankName: text(120),
        iban: text(60),
        instructions: text(500),
        isActive: z.boolean(),
      })
    )
    .max(30),
  methods: z
    .array(z.object({ id: z.string().optional(), name: z.string().trim().min(1).max(50), isActive: z.boolean() }))
    .min(1)
    .max(30),
})

export async function GET() {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  if (!checkPermission(session.user.role as Role, 'finance_settings', 'read')) return errors.forbidden()
  const [finance, accounts, methods] = await Promise.all([getFinanceSettings(), listPaymentAccounts(), listPaymentMethods()])
  return successResponse({ finance, accounts, methods, autoWhatsAppAvailable: isAutoWhatsAppConfigured() })
}

export async function PUT(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  if (!checkPermission(session.user.role as Role, 'finance_settings', 'update')) return errors.forbidden()

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.badRequest('Invalid JSON')
  }
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)
  const { finance, accounts, methods } = parsed.data

  const names = methods.map((m) => m.name.toLowerCase())
  if (new Set(names).size !== names.length) return errors.badRequest('Two payment methods have the same name')
  if (!methods.some((m) => m.isActive)) return errors.badRequest('Keep at least one payment method active')

  const existingMethods = await listPaymentMethods()
  const systemMissing = existingMethods.filter((m) => m.isSystem && !methods.some((x) => x.id === m.id))
  if (systemMissing.length) {
    return errors.badRequest(`Built-in methods cannot be removed (you can rename or keep them): ${systemMissing.map((m) => m.name).join(', ')}`)
  }

  await prisma.$transaction(async (tx) => {
    // Accounts: update sent ones, create new ones, delete the rest.
    const keepAccountIds = accounts.filter((a) => a.id).map((a) => a.id!)
    await tx.paymentAccount.deleteMany({ where: { id: { notIn: keepAccountIds } } })
    for (const [i, a] of accounts.entries()) {
      const data = {
        kind: a.kind as string,
        label: a.label as string,
        accountName: a.accountName ?? null,
        accountNumber: a.accountNumber ?? null,
        bankName: a.bankName ?? null,
        iban: a.iban ?? null,
        instructions: a.instructions ?? null,
        isActive: a.isActive !== false,
        sortOrder: i,
      }
      if (a.id) await tx.paymentAccount.update({ where: { id: a.id }, data })
      else await tx.paymentAccount.create({ data })
    }
    // Methods: same, but built-in ones are never deleted (and keep their name).
    const keepMethodIds = methods.filter((m) => m.id).map((m) => m.id!)
    await tx.paymentMethod.deleteMany({ where: { id: { notIn: keepMethodIds }, isSystem: false } })
    for (const [i, m] of methods.entries()) {
      const current = existingMethods.find((x) => x.id === m.id)
      if (current) {
        await tx.paymentMethod.update({
          where: { id: current.id },
          data: { name: current.isSystem ? current.name : m.name, isActive: m.isActive, sortOrder: i },
        })
      } else {
        await tx.paymentMethod.create({ data: { name: m.name, isActive: m.isActive, sortOrder: i } })
      }
    }
  })
  if (finance.autoSendReceiptWhatsApp && !isAutoWhatsAppConfigured()) {
    return errors.badRequest('Automatic WhatsApp needs a WhatsApp Business API account first')
  }
  await saveFinanceSettings(
    {
      invoiceDueDays: Number(finance.invoiceDueDays),
      receiptPaper: finance.receiptPaper ?? '80mm',
      receiptAfterPayment: finance.receiptAfterPayment ?? 'OPEN',
      companyName: finance.companyName || 'TechNova',
      companyPhone: finance.companyPhone ?? '',
      companyAddress: finance.companyAddress ?? '',
      receiptFooter: finance.receiptFooter ?? '',
      autoSendReceiptWhatsApp: !!finance.autoSendReceiptWhatsApp,
    },
    session.user.id
  )

  try {
    await logAudit({
      prismaClient: prisma,
      userId: session.user.id,
      action: 'UPDATE',
      entityType: 'FinanceSettings',
      changes: { finance, accounts: accounts.length, methods: methods.map((m) => m.name) },
      request,
    })
  } catch (err) {
    console.error('[FINANCE_SETTINGS_AUDIT]', err)
  }

  const [f, a, m] = await Promise.all([getFinanceSettings(), listPaymentAccounts(), listPaymentMethods()])
  return successResponse({ finance: f, accounts: a, methods: m, autoWhatsAppAvailable: isAutoWhatsAppConfigured() }, 'Saved')
}
