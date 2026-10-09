/**
 * Agreements (docs/plan-learning-platform.md §16–17).
 *  - The admin writes each agreement (AR / EN) for an audience: PARENT, STUDENT or STAFF.
 *  - Editing the title or the text publishes a NEW VERSION; everyone must accept it again (after an optional grace
 *    period during which a previous acceptance still counts).
 *  - Mandatory, active agreements block the portal until accepted (AgreementsGate).
 *  - Proof: who, which version, when, IP and device (AgreementAcceptance).
 *  - Media consent is ONE mandatory text (no per-child choice). The staff-only Student.noMarketing flag covers rare
 *    exceptions agreed offline.
 * Draft texts are created switched OFF: the owner reviews them (ideally with a lawyer) and switches them on.
 * Server-only.
 */

import { prisma } from '@/lib/prisma'
import { isModuleOn } from '@/lib/platform/settings'

export type AgreementAudience = 'PARENT' | 'STUDENT' | 'STAFF'
const STAFF_ROLES = ['SUPER_ADMIN', 'ADMIN', 'BRANCH_MANAGER', 'SECRETARY', 'ACCOUNTANT', 'MARKETING', 'TEACHER']

export function audienceOf(role: string): AgreementAudience | null {
  if (role === 'PARENT' || role === 'GUARDIAN') return 'PARENT'
  if (role === 'STUDENT') return 'STUDENT'
  if (STAFF_ROLES.includes(role)) return 'STAFF'
  return null
}

/** Agreements this user still has to accept (current version). `blocking` = must accept now. */
export async function pendingAgreements(user: { id: string; role: string }) {
  if (!(await isModuleOn('agreements'))) return []
  const audience = audienceOf(user.role)
  if (!audience) return []
  const list = await prisma.agreement.findMany({ where: { audience, isActive: true, mandatory: true }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] })
  if (!list.length) return []
  const accepted = await prisma.agreementAcceptance.findMany({ where: { userId: user.id, agreementId: { in: list.map((a) => a.id) } }, select: { agreementId: true, version: true } })
  const now = Date.now()
  const out = []
  for (const a of list) {
    const mine = accepted.filter((x) => x.agreementId === a.id)
    if (mine.some((x) => x.version === a.version)) continue
    const hadOlder = mine.length > 0
    const inGrace = hadOlder && a.graceDays > 0 && a.publishedAt.getTime() + a.graceDays * 86_400_000 > now
    out.push({ id: a.id, key: a.key, version: a.version, titleEn: a.titleEn, titleAr: a.titleAr, bodyEn: a.bodyEn, bodyAr: a.bodyAr, updated: hadOlder, blocking: !inGrace })
  }
  return out
}

export async function acceptAgreement(input: { agreementId: string; version: number; userId: string; role: string; ip?: string | null; userAgent?: string | null }) {
  const a = await prisma.agreement.findUnique({ where: { id: input.agreementId } })
  if (!a || !a.isActive) return { ok: false, message: 'Agreement not found' }
  if (a.audience !== audienceOf(input.role)) return { ok: false, message: 'This agreement is not for your account' }
  if (a.version !== input.version) return { ok: false, message: 'This agreement was updated — please read the new version' }
  await prisma.agreementAcceptance.upsert({
    where: { agreementId_version_userId: { agreementId: a.id, version: a.version, userId: input.userId } },
    create: { agreementId: a.id, version: a.version, userId: input.userId, ip: input.ip?.slice(0, 64) ?? null, userAgent: input.userAgent?.slice(0, 300) ?? null },
    update: {},
  })
  return { ok: true }
}

/** Who accepted the current version and who has not (staff report). */
export async function agreementStatus(agreementId: string) {
  const a = await prisma.agreement.findUnique({ where: { id: agreementId } })
  if (!a) return null
  const roles = a.audience === 'PARENT' ? ['PARENT', 'GUARDIAN'] : a.audience === 'STUDENT' ? ['STUDENT'] : STAFF_ROLES
  const users = await prisma.user.findMany({
    where: { isActive: true, role: { in: roles as never } },
    select: { id: true, email: true, displayName: true, role: true, guardian: { select: { firstName: true, lastName: true, phoneNumber: true } }, student: { select: { firstName: true, lastName: true, registrationNumber: true } } },
  })
  const acc = await prisma.agreementAcceptance.findMany({ where: { agreementId: a.id, version: a.version }, select: { userId: true, acceptedAt: true, ip: true, userAgent: true } })
  const accMap = new Map(acc.map((x) => [x.userId, x]))
  const name = (u: (typeof users)[number]) =>
    u.guardian ? `${u.guardian.firstName} ${u.guardian.lastName}`.trim() : u.student ? `${u.student.firstName} ${u.student.lastName}` : u.displayName ?? u.email
  const rows = users.map((u) => ({
    userId: u.id, name: name(u), role: u.role,
    contact: u.guardian?.phoneNumber ?? u.student?.registrationNumber ?? u.email,
    acceptedAt: accMap.get(u.id)?.acceptedAt ?? null,
    device: accMap.get(u.id)?.userAgent ?? null,
  }))
  return { agreement: { id: a.id, key: a.key, titleEn: a.titleEn, titleAr: a.titleAr, version: a.version, audience: a.audience }, accepted: rows.filter((r) => r.acceptedAt).length, pending: rows.filter((r) => !r.acceptedAt).length, rows }
}

const DRAFTS: { key: string; audience: AgreementAudience; titleEn: string; titleAr: string; bodyEn: string; bodyAr: string; sortOrder: number }[] = [
  {
    key: 'parent-rules', audience: 'PARENT', sortOrder: 1,
    titleEn: 'TechNova rules for parents', titleAr: 'قواعد TechNova لأولياء الأمور',
    bodyEn: 'DRAFT — please review and edit before switching on.\n\n1. Fees are paid in advance for each month / level as shown in the portal.\n2. Absences are counted as used sessions; please send an excuse from the portal when your child cannot attend.\n3. Please be on time to drop off and pick up your child.\n4. Communication with TechNova goes through the portal and the official numbers.\n5. Respect for instructors, staff and other students is required; misconduct may lead to suspension.\n6. Damage caused on purpose to equipment may be charged.\n7. TechNova may change session times or instructors when needed and will notify you in the portal.',
    bodyAr: 'مسودة — من فضلك راجعها وعدّلها قبل التشغيل.\n\n١. الرسوم تُدفع مقدمًا لكل شهر / مستوى كما هو موضح في البوابة.\n٢. الغياب يُحتسب من الحصص؛ من فضلك ابعت عذر من البوابة لو ابنك مش هيقدر يحضر.\n٣. من فضلك الالتزام بمواعيد التوصيل والاستلام.\n٤. التواصل مع TechNova من خلال البوابة والأرقام الرسمية.\n٥. احترام المدربين والموظفين والطلبة الآخرين مطلوب، وأي سلوك غير لائق ممكن يؤدي للإيقاف.\n٦. أي تلف متعمد في الأدوات ممكن يُحاسب عليه.\n٧. ممكن TechNova تغيّر مواعيد الحصص أو المدرب عند الحاجة، وهيتم إبلاغك من البوابة.',
  },
  {
    key: 'privacy-policy', audience: 'PARENT', sortOrder: 2,
    titleEn: 'Privacy policy', titleAr: 'سياسة الخصوصية',
    bodyEn: 'DRAFT — to be reviewed by a lawyer (Egypt Personal Data Protection Law No. 151 of 2020).\n\nTechNova collects the data needed to teach your child and run the service (names, contact details, attendance, results, payments). Data is stored securely, used only by TechNova staff who need it, never sold, and shared only with service providers we use (e.g. hosting, payments, messaging) under their protection rules. You can ask to see or correct your data at any time.',
    bodyAr: 'مسودة — يراجعها محامٍ (قانون حماية البيانات الشخصية المصري رقم 151 لسنة 2020).\n\nتجمع TechNova البيانات اللازمة لتعليم ابنك وتشغيل الخدمة (الأسماء، وبيانات التواصل، والحضور، والنتائج، والمدفوعات). البيانات محفوظة بأمان، ولا يستخدمها إلا موظفو TechNova المحتاجون لها، ولا تُباع أبدًا، ولا تُشارك إلا مع مقدمي الخدمات الذين نستخدمهم (مثل الاستضافة والدفع والرسائل) وفق قواعد حمايتهم. يمكنك طلب الاطلاع على بياناتك أو تصحيحها في أي وقت.',
  },
  {
    key: 'media-consent', audience: 'PARENT', sortOrder: 3,
    titleEn: 'Photos and videos', titleAr: 'الصور والفيديوهات',
    bodyEn: 'DRAFT — to be reviewed by a lawyer.\n\nI agree that TechNova may photograph and film sessions, activities and events in which my child takes part, and may use these photos, videos and my child\'s projects in the TechNova Passport, galleries, reports and TechNova marketing (website, social media, printed material).',
    bodyAr: 'مسودة — يراجعها محامٍ.\n\nأوافق على أن تقوم TechNova بتصوير الحصص والأنشطة والفعاليات التي يشارك فيها ابني/ابنتي صورًا وفيديو، واستخدام هذه الصور والفيديوهات ومشاريع ابني/ابنتي في جواز TechNova والمعارض والتقارير ودعاية TechNova (الموقع، ووسائل التواصل الاجتماعي، والمطبوعات).',
  },
  {
    key: 'platform-fee', audience: 'PARENT', sortOrder: 4,
    titleEn: 'Platform subscription', titleAr: 'اشتراك المنصة',
    bodyEn: 'DRAFT — only needed if the platform fee is switched on.\n\nA monthly platform fee is charged for every active student to run the TechNova portal and learning platform. If it is not paid after the grace period, access to the portal may be limited as shown in the portal.',
    bodyAr: 'مسودة — مطلوبة فقط لو رسوم المنصة متشغلة.\n\nتُحصّل رسوم شهرية للمنصة على كل طالب نشط لتشغيل بوابة TechNova والمنصة التعليمية. وفي حالة عدم الدفع بعد فترة السماح، قد يتم تقييد الوصول إلى البوابة كما هو موضح فيها.',
  },
  {
    key: 'student-rules', audience: 'STUDENT', sortOrder: 1,
    titleEn: 'Rules for students', titleAr: 'قواعد الطلبة',
    bodyEn: 'DRAFT — please review and edit.\n\n1. Be kind and respectful to everyone.\n2. Take care of the robots, kits and computers.\n3. Do your homework and ask when you need help.\n4. Do not share your password or the lessons with anyone.',
    bodyAr: 'مسودة — من فضلك راجعها وعدّلها.\n\n١. كن لطيفًا ومحترمًا مع الجميع.\n٢. حافظ على الروبوتات والأدوات والأجهزة.\n٣. اعمل واجبك واسأل لما تحتاج مساعدة.\n٤. لا تشارك كلمة المرور أو الدروس مع أي حد.',
  },
]

/** Creates the draft texts once (switched OFF). */
export async function ensureDraftAgreements(userId: string) {
  const existing = new Set((await prisma.agreement.findMany({ select: { key: true } })).map((a) => a.key))
  const todo = DRAFTS.filter((d) => !existing.has(d.key))
  if (todo.length) await prisma.agreement.createMany({ data: todo.map((d) => ({ ...d, isActive: false, mandatory: true, updatedById: userId })), skipDuplicates: true })
}
