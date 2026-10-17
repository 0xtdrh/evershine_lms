/**
 * GET  /api/accountant/expenses — List campus-scoped expenses
 * POST /api/accountant/expenses — Create a new expense record
 */

import { campusWhere, narrow, placeForCreate } from '@/lib/places/rules'
import { requestPlaces } from '@/lib/places/server'
import { NextRequest } from 'next/server'
import { Prisma } from '@prisma/client'
import { auth } from '@/lib/auth'
import { checkPermission } from '@/lib/rbac'
import { prisma } from '@/lib/prisma'
import { errors, createdResponse, paginatedResponse } from '@/lib/api-response'
import { createExpenseSchema, expenseQuerySchema } from '@/lib/validation/expense'
import { expenseCategoryWhere, resolveExpenseCategory } from '@/lib/treasury/expense-category'
import { getExpenseColumnSupport, isExpensePaymentColumnMissingError } from '@/lib/accounting/expense-columns'

async function resolveExpenseRecorder(userId: string) {
  const accountant = await prisma.accountant.findUnique({
    where: { userId },
    select: { userId: true },
  })

  return {
    recordedBy: accountant?.userId ?? null,
    recordedByUserId: userId,
  }
}

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()

  if (!checkPermission(session.user.role, 'expenses', 'read')) {
    return errors.forbidden('Only finance staff and admins can view expenses')
  }

  // M0: expenses of the person's places
  const places = await requestPlaces(session.user)

  const { searchParams } = new URL(request.url)
  const parsed = expenseQuerySchema.safeParse(Object.fromEntries(searchParams))
  if (!parsed.success) return errors.validation(parsed.error)

  const { page, limit, category, startDate, endDate, period, campusId: filterCampusId } = parsed.data

  let dateFilter = {}
  if (startDate && endDate) {
    dateFilter = { gte: new Date(startDate), lte: new Date(endDate) }
  } else if (period) {
    const now = new Date()
    let start = new Date()
    switch (period) {
      case 'daily':   start = new Date(now.setHours(0, 0, 0, 0)); break
      case 'weekly':  start = new Date(now.setDate(now.getDate() - 7)); break
      case 'monthly': start = new Date(now.getFullYear(), now.getMonth(), 1); break
      case 'yearly':  start = new Date(now.getFullYear(), 0, 1); break
    }
    dateFilter = { gte: start }
  }

  const where = {
    isDeleted: false,
    ...campusWhere(narrow(places, filterCampusId)), // the place filter can only narrow
    ...(category ? { category } : {}),
    ...(parsed.data.categoryId ? await expenseCategoryWhere(parsed.data.categoryId) : {}),
    ...(Object.keys(dateFilter).length > 0 ? { date: dateFilter } : {}),
  }

  const supportedColumns = await getExpenseColumnSupport()
  const expenseSelect = {
    id: true,
    title: true,
    description: true,
    amount: true,
    category: true,
    categoryId: true,
    date: true,
    campusId: true,
    receiptUrl: true,
    notes: true,
    ...(supportedColumns.paymentSource ? { paymentSource: true } : {}),
    ...(supportedColumns.paymentReference ? { paymentReference: true } : {}),
    recordedBy: true,
    isApproved: true,
    approvedBy: true,
    isDeleted: true,
    createdAt: true,
    updatedAt: true,
    accountant: {
      select: { firstName: true, lastName: true },
    },
    recordedByUser: {
      select: { email: true },
    },
  }

  const [total, expenses] = await Promise.all([
    prisma.expense.count({ where }),
    prisma.expense.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { date: 'desc' },
      select: expenseSelect,
    }),
  ])

  return paginatedResponse(expenses, { page, limit, total })
}

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()

  if (!checkPermission(session.user.role, 'expenses', 'create')) {
    return errors.forbidden('Only finance staff can record expenses')
  }

  const places = await requestPlaces(session.user)

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.validation({ errors: [{ path: [], message: 'Invalid JSON body' }] } as never)
  }

  const parsed = createExpenseSchema.safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)

  const data = parsed.data

  // M0: the chosen place must be one of the person's places (else their own place)
  const pick = placeForCreate(places, data.campusId ?? null)
  if (!pick.ok && data.campusId) return errors.forbidden('This place is not yours')
  const targetCampusId = pick.campusId
  if (!targetCampusId) {
    return errors.validation({
      errors: [{ path: ['campusId'], message: 'You must select a campus to record an expense' }],
    } as never)
  }

  const supportedColumns = await getExpenseColumnSupport()
  const recorder = await resolveExpenseRecorder(session.user.id)

  const cat = await resolveExpenseCategory(data.categoryId, data.category)
  if (!cat) return errors.badRequest('Choose a category')
  const expensePayload = {
    title: data.title,
    description: data.description,
    amount: data.amount,
    category: cat.category,
    categoryId: cat.categoryId,
    date: new Date(data.date),
    campusId: targetCampusId,
    receiptUrl: data.receiptUrl,
    notes: data.notes,
    recordedBy: recorder.recordedBy,
    recordedByUserId: recorder.recordedByUserId,
    isApproved: true,
    approvedBy: session.user.id,
    ...(supportedColumns.paymentSource && data.paymentSource ? { paymentSource: data.paymentSource } : {}),
    ...(supportedColumns.paymentReference && data.paymentReference ? { paymentReference: data.paymentReference } : {}),
  }

  const stripPaymentMetadata = (
    payload: Prisma.ExpenseUncheckedCreateInput,
  ): Prisma.ExpenseUncheckedCreateInput => {
    const safePayload = { ...payload }
    delete safePayload.paymentSource
    delete safePayload.paymentReference
    return safePayload
  }

  let newExpense
  try {
    console.debug('[EXPENSE_CREATE] attempt', {
      userId: session.user.id,
      campusId: targetCampusId,
      supportedColumns,
      payloadKeys: Object.keys(expensePayload),
      includesPaymentSource: 'paymentSource' in expensePayload,
      includesPaymentReference: 'paymentReference' in expensePayload,
    })
    newExpense = await prisma.expense.create({ data: expensePayload })
  } catch (err) {
    if (isExpensePaymentColumnMissingError(err)) {
      const safePayload = stripPaymentMetadata(expensePayload)
      console.warn('[EXPENSE_CREATE]', 'Retrying without payment metadata after unsupported Expense payment column', {
        userId: session.user.id,
        campusId: targetCampusId,
        supportedColumns,
        keys: Object.keys(safePayload),
        hasPaymentSource: 'paymentSource' in safePayload,
        hasPaymentReference: 'paymentReference' in safePayload,
      })
      newExpense = await prisma.expense.create({ data: safePayload })
    } else {
      throw err
    }
  }

  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      action: 'CREATE',
      entityType: 'Expense',
      entityId: newExpense.id,
      changes: { amount: data.amount, category: data.category },
    },
  })

  const expense = newExpense

  return createdResponse(expense, 'Expense recorded successfully')
}
