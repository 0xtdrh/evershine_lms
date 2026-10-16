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

const DRAFTS: { key: string; audience: AgreementAudience; titleEn: string; titleAr: string; bodyEn: string; bodyAr: string; sortOrder: number; isPublic?: boolean }[] = [
  {
    key: 'parent-rules', audience: 'PARENT', sortOrder: 1,
    titleEn: 'TechNova rules for parents', titleAr: 'قواعد TechNova لأولياء الأمور',
    bodyEn: 'DRAFT — please review and edit before switching on.\n\n1. Fees are paid in advance for each month / level as shown in the portal.\n2. Absences are counted as used sessions; please send an excuse from the portal when your child cannot attend.\n3. Please be on time to drop off and pick up your child.\n4. Communication with TechNova goes through the portal and the official numbers.\n5. Respect for instructors, staff and other students is required; misconduct may lead to suspension.\n6. Damage caused on purpose to equipment may be charged.\n7. TechNova may change session times or instructors when needed and will notify you in the portal.',
    bodyAr: 'مسودة — من فضلك راجعها وعدّلها قبل التشغيل.\n\n١. الرسوم تُدفع مقدمًا لكل شهر / مستوى كما هو موضح في البوابة.\n٢. الغياب يُحتسب من الحصص؛ من فضلك ابعت عذر من البوابة لو ابنك مش هيقدر يحضر.\n٣. من فضلك الالتزام بمواعيد التوصيل والاستلام.\n٤. التواصل مع TechNova من خلال البوابة والأرقام الرسمية.\n٥. احترام المدربين والموظفين والطلبة الآخرين مطلوب، وأي سلوك غير لائق ممكن يؤدي للإيقاف.\n٦. أي تلف متعمد في الأدوات ممكن يُحاسب عليه.\n٧. ممكن TechNova تغيّر مواعيد الحصص أو المدرب عند الحاجة، وهيتم إبلاغك من البوابة.',
  },
  {
    key: 'privacy-policy', audience: 'PARENT', sortOrder: 2, isPublic: true,
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
  // Rules & policies (2026-10-16): more drafts written by Claude — to be reviewed with a lawyer before switching on.
  {
    key: 'terms', audience: 'PARENT', sortOrder: 5, isPublic: true,
    titleEn: 'Terms and conditions', titleAr: 'الشروط والأحكام',
    bodyEn: 'DRAFT — to be reviewed by a lawyer before switching on.\n\n1. About: TechNova provides STEM, robotics and programming courses for children and young people at its branches, at partner places and online.\n2. Registration: a child is registered by the parent / guardian, who is responsible for the information given and for paying the fees.\n3. Groups: each group has its days, times, fee and rules, shown before joining; the parent accepts them in the portal.\n4. Fees: fees are paid in advance as shown on each invoice (see the payment policy). Prices may change for new months or levels; you will be told before.\n5. Attendance: absences count as used sessions; see the attendance and make-up policy.\n6. Refunds: see the refund policy.\n7. Behaviour and safety: children must respect instructors, staff and other children and take care of the equipment. Serious or repeated misconduct may lead to suspension without refund for the sessions already used.\n8. Changes: TechNova may change an instructor, a time or a place when needed and will tell you in the portal; if a new time does not suit you, you may move to another group or ask for a refund of the sessions not yet used.\n9. Online lessons and the portal: accounts are personal; do not share passwords or lesson material.\n10. Responsibility: TechNova takes reasonable care of children during sessions. Parents are responsible for drop-off and pick-up on time.\n11. Personal data and photos: see the privacy policy and the photos and videos agreement.\n12. Contact and complaints: through the portal (complaints and suggestions) or the official numbers.\n13. These terms follow Egyptian law.',
    bodyAr: 'مسودة — يراجعها محامٍ قبل التشغيل.\n\n١. عن الخدمة: تقدم TechNova كورسات STEM وروبوتيكس وبرمجة للأطفال والشباب في فروعها وأماكن شركائها وأونلاين.\n٢. التسجيل: يسجّل الطفلَ وليُّ الأمر، وهو المسؤول عن صحة البيانات ودفع الرسوم.\n٣. الجروبات: لكل جروب أيامه ومواعيده ورسومه وقواعده، وبتظهر قبل الانضمام، وولي الأمر بيوافق عليها من البوابة.\n٤. الرسوم: تُدفع مقدمًا كما هو موضح في كل فاتورة (راجع سياسة الدفع). الأسعار ممكن تتغير للشهور أو المستويات الجديدة، وهيتم إبلاغك قبلها.\n٥. الحضور: الغياب بيتحسب من الحصص؛ راجع سياسة الحضور والتعويض.\n٦. الاسترداد: راجع سياسة الاسترداد.\n٧. السلوك والأمان: لازم الأطفال يحترموا المدربين والموظفين وزمايلهم ويحافظوا على الأدوات. السلوك السيئ الخطير أو المتكرر ممكن يؤدي للإيقاف من غير استرداد للحصص المستخدمة.\n٨. التغييرات: ممكن TechNova تغيّر المدرب أو المعاد أو المكان عند الحاجة وهتبلغك من البوابة؛ ولو المعاد الجديد مايناسبكش تقدر تنقل لجروب تاني أو تطلب استرداد الحصص اللي ماتاخدتش.\n٩. الدروس الأونلاين والبوابة: الحسابات شخصية؛ ممنوع مشاركة كلمة المرور أو محتوى الدروس.\n١٠. المسؤولية: TechNova بتهتم بالأطفال بشكل معقول أثناء الحصص، وولي الأمر مسؤول عن التوصيل والاستلام في المعاد.\n١١. البيانات والصور: راجع سياسة الخصوصية واتفاقية الصور والفيديوهات.\n١٢. التواصل والشكاوى: من البوابة (الشكاوى والاقتراحات) أو الأرقام الرسمية.\n١٣. الشروط دي خاضعة للقانون المصري.',
  },
  {
    key: 'refund-policy', audience: 'PARENT', sortOrder: 6, isPublic: true,
    titleEn: 'Refund policy', titleAr: 'سياسة الاسترداد',
    bodyEn: 'DRAFT — to be reviewed by a lawyer before switching on.\n\n1. You can ask for a refund from the portal or at the branch.\n2. The amount refunded = what you paid, minus the sessions already used (attended or held, as the group rules say), minus an administration fee if the group has one. The exact rule of each group is shown in its rules before joining.\n3. Some groups or offers are not refundable; this is written in the group rules.\n4. A refund can be paid back in cash / by transfer, or kept in the TechNova wallet of the child to pay later invoices.\n5. Refunds are reviewed and approved by TechNova, normally within 7 working days.\n6. Discounts given on an invoice are not paid out in cash.\n7. If TechNova cancels a group or a session and cannot offer a replacement, the unused sessions are refunded in full.\n8. Online payments are refunded the same way they were paid when possible; payment gateway fees may not be refundable.',
    bodyAr: 'مسودة — يراجعها محامٍ قبل التشغيل.\n\n١. تقدر تطلب الاسترداد من البوابة أو من الفرع.\n٢. المبلغ اللي بيرجع = اللي دفعته، ناقص الحصص اللي اتاخدت (اللي حضرها أو اللي اتعملت حسب قواعد الجروب)، ناقص مصاريف إدارية لو الجروب فيه. قاعدة كل جروب بالظبط مكتوبة في قواعده قبل الانضمام.\n٣. بعض الجروبات أو العروض مابيترجعش فيها فلوس، وده مكتوب في قواعد الجروب.\n٤. الاسترداد بيرجع كاش / تحويل، أو بيفضل في محفظة الطفل في TechNova عشان يدفع الفواتير الجاية.\n٥. TechNova بتراجع الاسترداد وتوافق عليه، عادة خلال 7 أيام عمل.\n٦. الخصومات اللي على الفاتورة مابترجعش كاش.\n٧. لو TechNova لغت جروب أو حصة ومقدرتش تعوّضها، الحصص اللي ماتاخدتش بترجع كاملة.\n٨. الدفع الأونلاين بيرجع بنفس الطريقة لو ينفع، ومصاريف بوابة الدفع ممكن ماترجعش.',
  },
  {
    key: 'attendance-policy', audience: 'PARENT', sortOrder: 7,
    titleEn: 'Attendance, absence and make-up', titleAr: 'الحضور والغياب والتعويض',
    bodyEn: 'DRAFT — please review and edit before switching on.\n\n1. Attendance is recorded every session and is shown in the portal.\n2. An absence counts as a used session.\n3. If your child cannot come, send an excuse from the portal; within the time the group rules allow, it is accepted automatically or reviewed by TechNova. An excused absence still counts as a used session unless TechNova offers a make-up.\n4. Make-up: when possible TechNova may offer a session in another group of the same level at a similar time.\n5. Holidays move sessions to the next scheduled day; no session is lost.\n6. If TechNova cancels a session it is added at the end or made up.\n7. Two absences in a row: TechNova contacts you to check everything is fine.\n8. Please arrive on time; late arrival does not extend the session.',
    bodyAr: 'مسودة — من فضلك راجعها وعدّلها قبل التشغيل.\n\n١. الحضور بيتسجل كل حصة وبيظهر في البوابة.\n٢. الغياب بيتحسب من الحصص.\n٣. لو ابنك مش هيقدر يحضر ابعت عذر من البوابة؛ في المدة اللي قواعد الجروب بتسمح بيها بيتقبل تلقائي أو TechNova بتراجعه. الغياب بعذر برضه بيتحسب من الحصص إلا لو TechNova عرضت تعويض.\n٤. التعويض: لما ينفع، ممكن TechNova تعرض حصة في جروب تاني من نفس المستوى في معاد قريب.\n٥. الإجازات بتأجّل الحصة لمعاد الجروب اللي بعده، ومفيش حصة بتضيع.\n٦. لو TechNova لغت حصة بتتضاف في الآخر أو بتتعوّض.\n٧. غياب مرتين ورا بعض: TechNova بتتواصل معاك تطمن.\n٨. من فضلك الالتزام بالمعاد؛ التأخير مابيطوّلش الحصة.',
  },
  {
    key: 'payment-policy', audience: 'PARENT', sortOrder: 8,
    titleEn: 'Payment policy', titleAr: 'سياسة الدفع',
    bodyEn: 'DRAFT — please review and edit before switching on.\n\n1. Each month (or level) has an invoice, shown in the portal with its due date.\n2. You can pay at the branch, by transfer to the accounts shown in the portal (then upload the receipt), or online when available.\n3. TechNova wallet: money you put in the wallet pays new invoices automatically. Every payment and refund appears in the wallet statement.\n4. Some groups need the full fee before they start; some allow paying part or in instalments — this is written in the rules of each group.\n5. A student who has not paid by the middle of the month may be excluded from the group.\n6. Every payment has a numbered receipt (TN-RCPT-…), on paper or on WhatsApp.\n7. Discounts (siblings, offers, early renewal, …) appear on the invoice.\n8. The only bank details are the ones shown in the portal; TechNova will never ask you to pay to a personal account.',
    bodyAr: 'مسودة — من فضلك راجعها وعدّلها قبل التشغيل.\n\n١. لكل شهر (أو مستوى) فاتورة بتظهر في البوابة بمعاد استحقاقها.\n٢. تقدر تدفع في الفرع، أو تحويل على الحسابات اللي في البوابة (وترفع الإيصال)، أو أونلاين لما يتاح.\n٣. محفظة TechNova: الفلوس اللي في المحفظة بتدفع الفواتير الجديدة تلقائي، وكل دفعة واسترداد بيظهروا في كشف المحفظة.\n٤. بعض الجروبات لازم الرسوم كاملة قبل البداية، وبعضها بيسمح بجزء أو تقسيط — ده مكتوب في قواعد كل جروب.\n٥. الطالب اللي مادفعش لحد نص الشهر ممكن يتشال من الجروب.\n٦. كل دفعة ليها إيصال مرقّم (TN-RCPT-…) ورقي أو على واتساب.\n٧. الخصومات (إخوات، عروض، تجديد بدري، …) بتظهر على الفاتورة.\n٨. الحسابات البنكية هي اللي في البوابة بس، وTechNova عمرها ما هتطلب منك تحوّل على حساب شخصي.',
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
