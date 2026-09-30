/**
 * Temporary portal passwords for a student or their parent (the "Portal access"
 * card on the student page). Pure helpers, safe to import on client and server.
 *
 * WHY: default passwords never open an account (lib/portal-login.ts), so staff
 * must issue a temporary one. Doing it by hand led to weak shared passwords
 * ("123456" for everyone). This generates a strong, readable one; the account
 * must change it on first sign-in (User.mustChangePassword).
 */

const WORDS = [
  'Kite', 'Robot', 'Rocket', 'Pixel', 'Laser', 'Gear', 'Orbit', 'Comet',
  'Falcon', 'Tiger', 'Panda', 'Eagle', 'Shark', 'Zebra', 'Koala', 'Otter',
  'Maple', 'Cedar', 'Lotus', 'Coral', 'River', 'Delta', 'Oasis', 'Dune',
  'Amber', 'Ruby', 'Jade', 'Pearl', 'Onyx', 'Topaz', 'Opal', 'Ivory',
  'Piano', 'Drum', 'Flute', 'Violin', 'Harp', 'Cello', 'Banjo', 'Bell',
  'Spark', 'Blaze', 'Storm', 'Cloud', 'Frost', 'Solar', 'Lunar', 'Nova',
  'Motor', 'Radar', 'Sonar', 'Magnet', 'Circuit', 'Sensor', 'Servo', 'Chip',
  'Atlas', 'Vector', 'Matrix', 'Prism', 'Quartz', 'Nexus', 'Zenith', 'Photon',
]

/**
 * e.g. "Rocket-4827-Coral": 64 x 10,000 x 64 = ~41 million combinations.
 * Enough for a password that must be changed on first sign-in, with sign-in
 * locked after 5 wrong tries (lib/login-throttle.ts).
 */
export function generateTempPassword(randomInt: (max: number) => number): string {
  const w1 = WORDS[randomInt(WORDS.length)]
  let w2 = WORDS[randomInt(WORDS.length)]
  if (w2 === w1) w2 = WORDS[(WORDS.indexOf(w1) + 1 + randomInt(WORDS.length - 1)) % WORDS.length]
  const digits = String(randomInt(10_000)).padStart(4, '0')
  return `${w1}-${digits}-${w2}`
}

/** Egyptian number -> international digits for wa.me (01012345678 -> 201012345678). Null if unusable. */
export function whatsappNumber(phone: string | null | undefined): string | null {
  const d = (phone ?? '').replace(/[^\d+]/g, '').replace(/^\+/, '').replace(/^00/, '')
  if (/^01\d{9}$/.test(d)) return `2${d}`
  if (/^201\d{9}$/.test(d)) return d
  if (/^\d{8,15}$/.test(d) && !d.startsWith('0')) return d
  return null
}

export interface PortalMessageInput {
  target: 'guardian' | 'student'
  studentName: string
  loginId: string
  password: string
  loginUrl: string
}

/** The Arabic message staff send (copy or WhatsApp). */
export function portalMessage(m: PortalMessageInput): string {
  const who = m.target === 'guardian' ? `ولي أمر الطالب/ة ${m.studentName}` : `الطالب/ة ${m.studentName}`
  return [
    `أهلاً بحضرتك، دي بيانات دخول بوابة TechNova لـ ${who}:`,
    `الرابط: ${m.loginUrl}`,
    `${m.target === 'guardian' ? 'رقم الدخول' : 'اسم الدخول'}: ${m.loginId}`,
    `الباسورد المؤقت: ${m.password}`,
    'أول ما تدخل هيطلب منك تغيّر الباسورد لباسورد خاص بيك.',
  ].join('\n')
}
