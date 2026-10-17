/**
 * FIN-1: the expense form now picks an editable category (ExpenseCategoryDef). The old `Expense.category` enum column
 * stays filled (the built-in key, or MISCELLANEOUS for a new category) so old reports keep working. Server-only.
 */

import type { ExpenseCategory } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { expenseCategories } from './engine'
import { ENUM_CATEGORIES } from './rules'

export async function resolveExpenseCategory(categoryId?: string | null, category?: string | null): Promise<{ category: ExpenseCategory; categoryId: string | null } | null> {
  // an old built-in key with no id: nothing to look up (filters still match it through the key)
  if (!categoryId && category && ENUM_CATEGORIES.includes(category)) return { category: category as ExpenseCategory, categoryId: null }
  const defs = await expenseCategories(true)
  const def = categoryId ? defs.find((d) => d.id === categoryId || d.key === categoryId) : category ? defs.find((d) => d.key === category) : null
  if (def) return { category: (ENUM_CATEGORIES.includes(def.key) ? def.key : 'MISCELLANEOUS') as ExpenseCategory, categoryId: def.id }
  if (category && ENUM_CATEGORIES.includes(category)) return { category: category as ExpenseCategory, categoryId: null }
  return null
}

/**
 * FIN-3: the display name of an expense's category (editable category first, else the built-in key's category) —
 * so reports (P&L, expense export) show the owner's names instead of the old fixed keys.
 */
export async function expenseCategoryNamer(): Promise<(e: { categoryId?: string | null; category: string }) => { en: string; ar: string }> {
  const defs = await expenseCategories(true)
  const byId = new Map(defs.map((d) => [d.id, d]))
  const byKey = new Map(defs.map((d) => [d.key, d]))
  return (e) => {
    const d = (e.categoryId && byId.get(e.categoryId)) || byKey.get(e.category)
    return d ? { en: d.nameEn, ar: d.nameAr } : { en: e.category, ar: e.category }
  }
}

/** Filter by an editable category (old rows without a categoryId match through the built-in key). */
export async function expenseCategoryWhere(categoryId: string) {
  const def = await prisma.expenseCategoryDef.findUnique({ where: { id: categoryId } })
  if (!def) return { categoryId }
  return ENUM_CATEGORIES.includes(def.key)
    ? { OR: [{ categoryId: def.id }, { categoryId: null, category: def.key as ExpenseCategory }] }
    : { categoryId: def.id }
}
