/**
 * x01 — TechNova public website: the content of the home page.
 *
 * Every block and every item carries `show` (hide it without deleting it) and two languages. Items marked `sample` are
 * examples for the design preview only: they never appear on the real site. A section whose real items are all hidden or
 * empty disappears (owner rule: nothing empty, nothing invented).
 *
 * Today this object is the source. The next batch moves it into the system ("Website" settings screen) with the same
 * shape, so every text / element becomes editable and switchable there.
 */

export interface Bi { en: string; ar: string }
export interface Shown { show?: boolean; sample?: boolean }

export type StatSource = 'students' | 'sessions' | 'certificates' | 'partnerPlaces' | 'branches'
export interface StatItem extends Shown { label: Bi; source?: StatSource; value?: number; min?: number; plus?: boolean }

export interface Card extends Shown { title: Bi; text: Bi; icon?: string; href?: string; cta?: Bi; tag?: Bi }
export interface MediaCard extends Shown { title: Bi; meta: Bi; kind: 'video' | 'photo' | 'news' | 'event' | 'project' | 'competition' | 'product' }

export interface SiteContent {
  nav: (Shown & { label: Bi; href: string })[]
  contact: { whatsapp: string; phone: string; email: string; address: Bi; mapUrl: string; facebook: string; instagram: string; tiktok: string; youtube: string; linkedin: string }
  fields: Shown & { title: Bi; items: Card[] }
  hero: Shown & { kicker: string; title1: Bi; title2: Bi; tagline: string; text: Bi; videoUrl: string; primary: Bi; secondary: Bi }
  audience: Card[]
  stats: StatItem[]
  about: Shown & { title: Bi; text: Bi; steps: Bi[] }
  divisions: Shown & { title: Bi; items: Card[] }
  education: Shown & { title: Bi; text: Bi; families: Card; schools: Card; ages: string[]; journey: (Bi & { step: string })[] }
  curriculum: Shown & { title: Bi; text: Bi; programmes: (Shown & { name: string; ages: Bi })[]; points: Card[]; note: Bi }
  solutions: Shown & { title: Bi; text: Bi; items: Card[]; cta: Bi }
  why: Shown & { title: Bi; items: Card[] }
  achievements: Shown & { title: Bi; text: Bi; items: MediaCard[] }
  verify: Shown & { title: Bi; text: Bi }
  products: Shown & { title: Bi; text: Bi; items: (MediaCard & { type: Bi })[] }
  partners: Shown & { title: Bi; text: Bi; kinds: Card[]; places: (Shown & { name: Bi })[] }
  events: Shown & { title: Bi; items: MediaCard[] }
  media: Shown & { title: Bi; items: MediaCard[] }
  cta: Shown & { title: Bi; text: Bi }
}

const b = (en: string, ar: string): Bi => ({ en, ar })

export const SITE_CONTENT: SiteContent = {
  nav: [
    { label: b('Education', 'التعليم'), href: '#education' },
    { label: b('Solutions', 'الحلول'), href: '#solutions' },
    { label: b('Products', 'المنتجات'), href: '#products' },
    { label: b('Achievements', 'الإنجازات'), href: '#achievements' },
    { label: b('Media', 'ميديا'), href: '#media' },
    { label: b('Partnerships', 'الشراكات'), href: '#partners' },
    { label: b('About TechNova', 'عن TechNova'), href: '#about' },
  ],
  contact: { whatsapp: '', phone: '', email: '', address: b('El Kawthar, Hurghada', 'الكوثر، الغردقة'), mapUrl: '', facebook: '', instagram: '', tiktok: '', youtube: '', linkedin: '' },
  // hidden until the owner decides what these tiles should say (2026-11-12)
  fields: {
    show: false,
    title: b('What would your child like to build?', 'ابنك حابب يبني إيه؟'),
    items: [
      { icon: 'robot', title: b('Robotics', 'روبوتكس'), text: b('Robots that move, sense and decide', 'روبوتات بتتحرك وتحس وتقرر'), href: '#curriculum' },
      { icon: 'code', title: b('Programming', 'برمجة'), text: b('From blocks to Python and C++', 'من البلوكات لحد Python و C++‎'), href: '#curriculum' },
      { icon: 'chip', title: b('Artificial intelligence', 'ذكاء اصطناعي'), text: b('Models that learn and recognise', 'نماذج بتتعلم وتتعرف'), href: '#curriculum' },
      { icon: 'bolt', title: b('Electronics & IoT', 'إلكترونيات وIoT'), text: b('Circuits, sensors and smart devices', 'دوائر وحساسات وأجهزة ذكية'), href: '#curriculum' },
      { icon: 'phone', title: b('Apps & games', 'تطبيقات وألعاب'), text: b('Games, apps and websites', 'ألعاب وتطبيقات ومواقع'), href: '#curriculum' },
    ],
  },
  hero: {
    kicker: 'WHERE IDEAS BECOME REALITY',
    title1: b('We teach technology…', 'بنعلّم التكنولوجيا…'),
    title2: b('and we build it.', 'وبنبنيها.'),
    tagline: 'Learn · Build · Innovate',
    text: b(
      'A technology company in Hurghada: programming and robotics education from age 4 to university, and smart solutions for businesses and organisations. One team, one experience.',
      'شركة تكنولوجيا في الغردقة: تعليم برمجة وروبوتكس من سن 4 للجامعة، وحلول ذكية للأعمال والمؤسسات. نفس الفريق، نفس الخبرة.',
    ),
    videoUrl: '',
    primary: b('Discover TechNova', 'اكتشف TechNova'),
    secondary: b('Start a conversation', 'ابدأ محادثة'),
  },
  audience: [
    { title: b('For my child', 'لابني / لبنتي'), text: b('Programmes by age and a report after every session', 'برامج حسب السن وتقرير بعد كل حصة'), href: '#education', cta: b('See the programmes', 'شوف البرامج') },
    { title: b('For my school', 'لمدرستي'), text: b('The TechNova programme inside your school', 'برنامج TechNova جوه مدرستك'), href: '#schools', cta: b('Ask for an offer', 'اطلب عرض') },
    { title: b('For business & organisations', 'للأعمال والمؤسسات'), text: b('Smart solutions and staff training', 'حلول ذكية وتدريب للموظفين'), href: '#solutions', cta: b('Ask for a solution', 'اطلب حل') },
    { title: b('Become a partner', 'عايز أبقى شريك'), text: b('Education, technology, sponsorship, investment', 'تعليم، تكنولوجيا، رعاية، استثمار'), href: '#partners', cta: b('Apply', 'قدّم طلب') },
  ],
  stats: [
    { label: b('students learned with us', 'طالب اتعلّم معانا'), source: 'students', min: 50, plus: true },
    { label: b('sessions delivered', 'حصة اتنفّذت'), source: 'sessions', min: 100, plus: true },
    { label: b('certificates issued', 'شهادة اتصدرت'), source: 'certificates', min: 20, plus: true },
    { label: b('partner schools & places', 'مدرسة ومكان شريك'), source: 'partnerPlaces', min: 3, plus: false },
    { label: b('divisions', 'أقسام في الشركة'), value: 4 },
  ],
  about: {
    title: b('More than technology — a complete ecosystem', 'أكتر من تكنولوجيا… منظومة كاملة'),
    text: b(
      'What we teach in class is what we use in our own projects, and what we learn from projects goes back into the curriculum. That is why learning with us is never just theory.',
      'اللي بنعلّمه في الحصة هو نفس اللي بنستخدمه في مشاريعنا، واللي بنتعلّمه من المشاريع بيرجع منهج للطلاب. علشان كده التعليم عندنا مش نظري.',
    ),
    steps: [b('Learn', 'نعلّم'), b('Innovate', 'نبتكر'), b('Build', 'ننفّذ')],
  },
  divisions: {
    title: b('Four divisions, one goal', '4 أقسام… هدف واحد'),
    items: [
      { icon: 'cap', title: b('Technology Education', 'تعليم التكنولوجيا'), text: b('Programming, robotics and STEM from age 4 to university — for families and schools.', 'برمجة وروبوتكس وSTEM من سن 4 للجامعة، للعائلات وللمدارس.'), href: '#education' },
      { icon: 'home', title: b('Smart Solutions', 'الحلول الذكية'), text: b('Smart hotels, homes and buildings, IoT and automation.', 'فنادق وبيوت ومباني ذكية، IoT وأتمتة.'), href: '#solutions' },
      { icon: 'chip', title: b('AI & Innovation', 'الذكاء الاصطناعي والابتكار'), text: b('AI-powered solutions and intelligent systems.', 'حلول بالذكاء الاصطناعي وأنظمة ذكية.'), href: '#solutions' },
      { icon: 'flask', title: b('Research & Development', 'البحث والتطوير'), text: b('Prototypes, products and new curricula.', 'نماذج أولية ومنتجات ومناهج جديدة.'), href: '#achievements' },
    ],
  },
  education: {
    title: b('From learning to creating', 'من التعلّم… للابتكار'),
    text: b('Two doors, depending on who you are.', 'بابين حسب إنت مين.'),
    families: { tag: b('B2C · Families', 'B2C · للعائلات'), title: b('For parents and students', 'لولي الأمر والطالب'), text: b('Programmes by age — in a branch, online, one-to-one or recorded courses. Parents follow every session from their portal.', 'برامج حسب السن، في الفرع أو أونلاين أو One-to-One أو كورسات مسجلة. وولي الأمر بيتابع كل حصة من البوابة.'), cta: b('See the programmes', 'شوف البرامج'), href: '#curriculum' },
    schools: { tag: b('B2B · Schools', 'B2B · للمدارس والمؤسسات'), title: b('For schools and organisations', 'للمدارس والمؤسسات'), text: b('A TechNova instructor, the curriculum, the platform, reports and certificates — inside your school.', 'مدرب TechNova، المنهج، المنصة، التقارير والشهادات… جوه مدرستك.'), cta: b('Ask for an offer for your school', 'اطلب عرض لمدرستك'), href: '#contact' },
    ages: ['4–7', '8–10', '11–14', '15+', '18+'],
    journey: [
      { step: 'Explore', en: 'Discovers technology and loves it', ar: 'يكتشف التكنولوجيا ويحبها' },
      { step: 'Learn', en: 'Learns the basics the right way', ar: 'يتعلّم الأساسيات صح' },
      { step: 'Build', en: 'Builds projects with his own hands', ar: 'يبني مشاريع بإيده' },
      { step: 'Compete', en: 'Competes in challenges', ar: 'ينافس في مسابقات' },
      { step: 'Create', en: 'Takes part in real projects', ar: 'يشارك في مشاريع حقيقية' },
    ],
  },
  curriculum: {
    title: b('A strong curriculum you can see', 'منهج قوي… تشوفه بعينك'),
    text: b(
      'Designed with reference to international frameworks (CSTA, AI4K12, the English national curriculum and WRO) and built for Egyptian students.',
      'مصمم بالرجوع لأطر دولية (CSTA وAI4K12 والمنهج الإنجليزي وWRO)، ومبني للطالب المصري.',
    ),
    programmes: [
      { name: 'Nova Explorers', ages: b('ages 5–7', 'سن 5–7') },
      { name: 'Nova Builders', ages: b('ages 8–10', 'سن 8–10') },
      { name: 'Nova Engineer', ages: b('ages 11–14', 'سن 11–14') },
      { name: 'Nova Innovators', ages: b('ages 15+', 'من سن 15') },
      { name: 'Nova Launch', ages: b('university & graduates', 'جامعة وخريجين') },
    ],
    points: [
      { icon: 'check', title: b('It works — guaranteed', 'هيمشي بحاجة شغالة'), text: b('Every level ends with a real product the student built and that works.', 'كل مستوى بيخلص بمنتج حقيقي الطالب بناه وشغال.') },
      { icon: 'layers', title: b('12 sessions, 3 sprints', '12 حصة في 3 مراحل'), text: b('Each sprint ends with something working, so progress is visible every month.', 'كل مرحلة بتخلص بحاجة شغالة، فالتقدم باين كل شهر.') },
      { icon: 'grow', title: b('8 skills that grow together', '8 مهارات بتكبر مع الطالب'), text: b('Programming, hardware, data, networks & safety, AI, projects, soft skills and impact.', 'برمجة، هاردوير، بيانات، شبكات وأمان، AI، مشاريع، Soft Skills، والأثر.') },
      { icon: 'eye', title: b('Parents see the progress', 'ولي الأمر شايف التقدم'), text: b('Three lines after every session and a show day at the end of every level.', '3 سطور بعد كل حصة، ويوم عرض في آخر كل مستوى.') },
      { icon: 'chip', title: b('Honest AI', 'AI مفيد ومراجَع'), text: b('Students use AI usefully and learn it can be wrong.', 'الطالب بيستخدم الـ AI صح، وبيتعلّم إنه ممكن يغلط.') },
      { icon: 'trophy', title: b('A bridge to competitions', 'باب للمسابقات'), text: b('Every level can open a challenge — local and international.', 'كل مستوى ممكن يفتح باب مسابقة، محلية ودولية.') },
    ],
    note: b('Designed with reference to these frameworks — not accredited by them.', 'مصمم بالرجوع للأطر دي، ومش معتمد منها.'),
  },
  solutions: {
    title: b('Technology that solves real problems', 'تكنولوجيا بتحل مشاكل حقيقية'),
    text: b('For hotels, homes, companies and organisations. Tell us the problem and we propose the solution.', 'للفنادق والبيوت والشركات والمؤسسات. قولّنا المشكلة وإحنا نقترح الحل.'),
    items: [
      { icon: 'hotel', title: b('Smart hotels & resorts', 'فنادق ومنتجعات ذكية'), text: b('Smart rooms, energy saving and a better guest experience.', 'غرف ذكية، توفير طاقة، وتجربة أحسن للنزيل.') },
      { icon: 'home', title: b('Smart homes & buildings', 'بيوت ومباني ذكية'), text: b('Lighting, air conditioning, security and phone control.', 'إضاءة، تكييف، أمان، وتحكم من الموبايل.') },
      { icon: 'wave', title: b('IoT & automation', 'IoT وأتمتة'), text: b('Sensors, monitoring and automatic operation.', 'حساسات، متابعة، وتشغيل تلقائي.') },
      { icon: 'code', title: b('Software & apps', 'برمجيات وتطبيقات'), text: b('Websites, systems and mobile apps.', 'مواقع وأنظمة وتطبيقات موبايل.') },
      { icon: 'chip', title: b('AI solutions', 'حلول بالذكاء الاصطناعي'), text: b('Chatbots, data analysis and work automation.', 'شات بوت، تحليل بيانات، وأتمتة الشغل.') },
      { icon: 'cap', title: b('Corporate training', 'تدريب الشركات'), text: b('AI and technology training for your staff.', 'تدريب AI وتكنولوجيا لموظفينك.') },
      { icon: 'screen', title: b('Educational technology', 'منتجات تعليمية EdTech'), text: b('Platforms and tools for schools and centres.', 'منصات وأدوات للمدارس والسناتر.') },
    ],
    cta: b('Ask for a solution', 'اطلب حل لمكانك'),
  },
  why: {
    title: b('Why TechNova?', 'ليه TechNova؟'),
    items: [
      { icon: 'layers', title: b('A strong curriculum', 'منهج قوي'), text: b('Built on international frameworks, with a real product in every level.', 'مبني على أطر دولية، ومنتج حقيقي في كل مستوى.') },
      { icon: 'eye', title: b('A complete system for parents', 'سيستم متكامل لولي الأمر'), text: b('A report after every session, attendance, wallet, online payment and the journey map.', 'تقرير بعد كل حصة، الحضور، المحفظة، الدفع أونلاين، وخريطة الرحلة.') },
      { icon: 'trophy', title: b('Local & international competitions', 'مسابقات محلية ودولية'), text: b('Students compete and show what they built.', 'الطلاب بينافسوا ويعرضوا اللي بنوه.') },
      { icon: 'tools', title: b('A team that builds', 'فريق بيبني مش بس بيشرح'), text: b('Instructors who work on real technology.', 'مدربين شغالين في تكنولوجيا حقيقية.') },
      { icon: 'route', title: b('Flexible ways to learn', 'طرق تعلّم مرنة'), text: b('Branch, online, one-to-one or recorded courses.', 'فرع، أونلاين، One-to-One، أو كورسات مسجلة.') },
      { icon: 'shield', title: b('A certificate you can check', 'شهادة تقدر تتأكد منها'), text: b('Anyone can verify it with its number or QR code.', 'أي حد يتأكد منها برقمها أو بالـ QR.') },
    ],
  },
  achievements: {
    title: b('Ideas in action', 'أفكار اتحوّلت لحاجة حقيقية'),
    text: b('Student projects, R&D prototypes and competitions.', 'مشاريع الطلاب، نماذج البحث والتطوير، والمسابقات.'),
    items: [
      { sample: true, kind: 'project', title: b('Reef guard', 'حارس الشعاب'), meta: b('Student project · Nova Builders', 'مشروع طالب · Nova Builders') },
      { sample: true, kind: 'project', title: b('Smart home model', 'نموذج بيت ذكي'), meta: b('Student project · Arduino', 'مشروع طالب · Arduino') },
      { sample: true, kind: 'competition', title: b('Competition team', 'فريق المسابقات'), meta: b('Competition · result', 'مسابقة · النتيجة') },
    ],
  },
  verify: {
    title: b('Check a certificate', 'تأكّد من شهادة'),
    text: b('Type the certificate number (TN-CERT-…) or scan its QR code.', 'اكتب رقم الشهادة (TN-CERT-…) أو امسح الـ QR اللي عليها.'),
  },
  products: {
    title: b('Our products', 'منتجاتنا'),
    text: b('Kits to keep learning at home, and technology products.', 'كيتات تكمّل بيها في البيت، ومنتجات تكنولوجيا.'),
    items: [
      { sample: true, kind: 'product', type: b('Educational', 'تعليمي'), title: b('Starter robotics kit', 'كيت روبوتكس للمبتدئين'), meta: b('Ages 8+', 'من سن 8') },
      { sample: true, kind: 'product', type: b('Educational', 'تعليمي'), title: b('micro:bit kit', 'كيت micro:bit'), meta: b('Ages 6+', 'من سن 6') },
      { sample: true, kind: 'product', type: b('Smart device', 'جهاز ذكي'), title: b('Smart device', 'جهاز ذكي'), meta: b('For homes', 'للبيوت') },
    ],
  },
  partners: {
    title: b("Let's build something greater together", 'يلا نبني حاجة أكبر سوا'),
    text: b('There is a way to work together for every kind of partner.', 'فيه شكل تعاون يناسب كل نوع شريك.'),
    kinds: [
      { icon: 'cap', title: b('Educational institutions', 'مؤسسات تعليمية'), text: b('Schools, nurseries, universities, clubs, NGOs and hotel kids clubs.', 'مدارس، حضانات، جامعات، نوادي، جمعيات، وكيدز كلَب الفنادق.') },
      { icon: 'building', title: b('Business & organisations', 'الأعمال والمؤسسات'), text: b('Smart solutions and staff training.', 'حلول ذكية وتدريب للموظفين.') },
      { icon: 'chip', title: b('Technology partners & suppliers', 'شركاء تقنيين وموردين'), text: b('Hardware, software and platforms.', 'هاردوير، برمجيات، ومنصات.') },
      { icon: 'trophy', title: b('Sponsors', 'رعاة'), text: b('Competitions, events and Nova Awards.', 'المسابقات والفعاليات وNova Awards.') },
      { icon: 'grow', title: b('Investors & media', 'مستثمرين وإعلام'), text: b('Grow with us.', 'اكبر معانا.') },
    ],
    places: [],
  },
  events: {
    title: b('Coming up', 'فعاليات جاية'),
    items: [
      { sample: true, kind: 'event', title: b('Winter Camp', 'Winter Camp'), meta: b('Date · place', 'التاريخ · المكان') },
      { sample: true, kind: 'event', title: b('Nova Awards', 'Nova Awards'), meta: b('Date · place', 'التاريخ · المكان') },
    ],
  },
  media: {
    title: b('Latest news & videos', 'آخر الأخبار والفيديوهات'),
    items: [
      { sample: true, kind: 'video', title: b('AI, simply — episode 1', 'AI ببساطة — الحلقة 1'), meta: b('Educational video', 'فيديو تعليمي') },
      { sample: true, kind: 'photo', title: b('Event album', 'ألبوم فعالية'), meta: b('Events', 'فعاليات') },
      { sample: true, kind: 'news', title: b('News title', 'عنوان خبر'), meta: b('News', 'أخبار') },
    ],
  },
  cta: {
    title: b("Let's create the future together", 'يلا نصنع المستقبل سوا'),
    text: b('Student, parent, school, business or partner — there is a place for you at TechNova.', 'طالب، ولي أمر، مدرسة، شركة، أو شريك… ليك مكان في TechNova.'),
  },
}

/** Items that may appear: shown, and not an example unless this is the design preview. */
export function visible<T extends Shown>(items: T[], preview: boolean): T[] {
  return items.filter((i) => i.show !== false && (preview || !i.sample))
}
