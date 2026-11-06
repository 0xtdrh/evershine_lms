/**
 * Security batch (2026-11-06): tell every active Super Admin at once when something dangerous happens (a new admin, a role raised,
 * permissions changed, a backup downloaded, test data wiped, a closed month reopened, a full export, a locked admin account).
 * Never breaks the action itself.
 */

import { prisma } from '@/lib/prisma'
import { notifyUsers } from '@/lib/notifications/events'

export type SecurityKind = 'NEW_ADMIN' | 'ROLE_RAISED' | 'PERMISSIONS' | 'BACKUP_DOWNLOAD' | 'WIPE' | 'MONTH_REOPEN' | 'FULL_EXPORT' | 'ADMIN_LOCKED' | 'ADMIN_RESET' | 'BACKUP_NEAR_LIMIT'

const TEXT: Record<SecurityKind, { en: string; ar: string }> = {
  NEW_ADMIN: { en: 'A new admin account was made', ar: 'اتعمل حساب مدير جديد' },
  ROLE_RAISED: { en: 'An account got a higher role', ar: 'حساب اترفعت صلاحيته' },
  PERMISSIONS: { en: 'Permissions were changed', ar: 'الصلاحيات اتغيرت' },
  BACKUP_DOWNLOAD: { en: 'A database backup was downloaded', ar: 'حد نزّل نسخة احتياطية من قاعدة البيانات' },
  WIPE: { en: 'Test data was wiped', ar: 'بيانات التجربة اتمسحت' },
  MONTH_REOPEN: { en: 'A closed month was reopened', ar: 'شهر مقفول اتفتح' },
  FULL_EXPORT: { en: 'A full list was exported', ar: 'قايمة كاملة اتصدّرت' },
  ADMIN_LOCKED: { en: 'An admin account was locked after wrong passwords', ar: 'حساب مدير اتقفل بعد باسوردات غلط' },
  ADMIN_RESET: { en: 'An admin password or email was reset', ar: 'باسورد أو إيميل حساب مدير اتغير' },
  BACKUP_NEAR_LIMIT: { en: 'The backup is close to the storage limit', ar: 'النسخة الاحتياطية قربت من حد التخزين' },
}

export async function securityAlert(kind: SecurityKind, detail: { actorId?: string | null; text?: string; textAr?: string } = {}) {
  try {
    const admins = await prisma.user.findMany({ where: { role: 'SUPER_ADMIN', isActive: true }, select: { id: true } })
    let who = ''
    if (detail.actorId) {
      const u = await prisma.user.findUnique({ where: { id: detail.actorId }, select: { email: true } })
      who = u?.email ?? ''
    }
    const t = TEXT[kind]
    await notifyUsers(admins.map((a) => a.id), 'SECURITY_ALERT', {
      title: `Security: ${t.en}`, titleAr: `تنبيه أمان: ${t.ar}`,
      message: [detail.text, who && `by ${who}`].filter(Boolean).join(' · ') || t.en,
      messageAr: [detail.textAr ?? detail.text, who && `بواسطة ${who}`].filter(Boolean).join(' · ') || t.ar,
    })
  } catch (err) {
    console.error('[SECURITY_ALERT]', kind, err)
  }
}
