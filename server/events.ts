import type { Db } from './db.ts';

export const MARKETS: Record<string, string> = {
  gulf: 'الخليج (عام)', saudi: 'السعودية', uae: 'الإمارات', kuwait: 'الكويت', qatar: 'قطر', bahrain: 'البحرين', oman: 'عُمان',
  egypt: 'مصر', levant: 'الشام', other: 'أخرى',
};
const GCC = ['saudi', 'uae', 'kuwait', 'qatar', 'bahrain', 'oman'];
export const marketsFor = (m: string): string[] => ['all', m, ...(m === 'gulf' ? GCC : GCC.includes(m) ? ['gulf'] : [])];

type Seed = { market: string; ar: string; en?: string; kind: 'fixed' | 'hijri' | 'note'; m?: number; d?: number; hm?: number; hd?: number; note?: string };
// IMPORTANT: every seeded row starts as verified=false. The admin must confirm dates/notes before they are trusted.
const SEEDS: Seed[] = [
  { market: 'all', ar: 'بداية رمضان', en: 'Ramadan begins', kind: 'hijri', hm: 9, hd: 1, note: 'التاريخ يعتمد على رؤية الهلال (±يوم). موسم المحتوى الأكبر في المنطقة.' },
  { market: 'all', ar: 'ليلة القدر (٢٧ رمضان تقريبًا)', kind: 'hijri', hm: 9, hd: 27, note: 'تاريخها محل خلاف؛ تعامل بحذر وبنبرة هادئة.' },
  { market: 'all', ar: 'عيد الفطر', en: 'Eid al-Fitr', kind: 'hijri', hm: 10, hd: 1, note: 'إجازة وهدايا وزيارات عائلية.' },
  { market: 'all', ar: 'يوم عرفة', kind: 'hijri', hm: 12, hd: 9, note: 'مناسبة دينية؛ تجنّب الحملات البيعية الصاخبة.' },
  { market: 'all', ar: 'عيد الأضحى', en: 'Eid al-Adha', kind: 'hijri', hm: 12, hd: 10, note: 'إجازة وأضاحي وهدايا.' },
  { market: 'all', ar: 'رأس السنة الهجرية', kind: 'hijri', hm: 1, hd: 1, note: 'مناسبة هادئة، ليست إجازة في كل الدول.' },
  { market: 'all', ar: 'رأس السنة الميلادية', kind: 'fixed', m: 1, d: 1, note: 'ملخصات العام وبدايات جديدة.' },
  { market: 'all', ar: 'عيد الحب (١٤ فبراير)', kind: 'fixed', m: 2, d: 14, note: 'مناسبة تجارية منتشرة لكنها مثيرة للجدل عند بعض الجمهور؛ راجع حساسية البراند.' },
  { market: 'all', ar: 'يوم الأم (٢١ مارس)', kind: 'fixed', m: 3, d: 21, note: 'يُحتفل به في مصر ودول عربية عدة.' },
  { market: 'all', ar: 'العودة للمدارس', kind: 'note', m: 8, note: 'أواخر أغسطس وسبتمبر تقريبًا، يختلف حسب الدولة.' },
  { market: 'all', ar: 'الجمعة البيضاء / البلاك فرايدي', kind: 'note', m: 11, note: 'أواخر نوفمبر؛ موسم تخفيضات كبير. لا تذكر خصومًا لم يقدّمها العميل.' },
  { market: 'all', ar: 'الكريسماس (٢٥ ديسمبر)', kind: 'fixed', m: 12, d: 25, note: 'ليست إجازة رسمية في الخليج ومصر؛ تُسوَّق تجاريًا في المولات وللمقيمين. تعامل بحساسية ثقافية وقرّر حسب جمهور البراند.' },
  { market: 'gulf', ar: 'الشتاء وموسم الطلعات والكشتات', kind: 'note', m: 12, note: 'موسم الأجواء المعتدلة والجلسات الخارجية (ديسمبر–فبراير تقريبًا).' },
  { market: 'gulf', ar: 'الصيف وموسم السفر', kind: 'note', m: 7, note: 'حرارة عالية وسفر وإجازات مدرسية.' },
  { market: 'saudi', ar: 'اليوم الوطني السعودي', kind: 'fixed', m: 9, d: 23 },
  { market: 'saudi', ar: 'يوم التأسيس السعودي', kind: 'fixed', m: 2, d: 22 },
  { market: 'uae', ar: 'اليوم الوطني الإماراتي', kind: 'fixed', m: 12, d: 2 },
  { market: 'kuwait', ar: 'اليوم الوطني الكويتي', kind: 'fixed', m: 2, d: 25 },
  { market: 'kuwait', ar: 'يوم التحرير الكويتي', kind: 'fixed', m: 2, d: 26 },
  { market: 'bahrain', ar: 'اليوم الوطني البحريني', kind: 'fixed', m: 12, d: 16 },
  { market: 'qatar', ar: 'اليوم الوطني القطري', kind: 'fixed', m: 12, d: 18 },
  { market: 'oman', ar: 'اليوم الوطني العُماني', kind: 'fixed', m: 11, d: 18 },
  { market: 'egypt', ar: 'عيد ثورة 25 يناير / عيد الشرطة', kind: 'fixed', m: 1, d: 25 },
  { market: 'egypt', ar: 'عيد تحرير سيناء', kind: 'fixed', m: 4, d: 25 },
  { market: 'egypt', ar: 'ثورة 23 يوليو', kind: 'fixed', m: 7, d: 23 },
  { market: 'egypt', ar: 'عيد القوات المسلحة (6 أكتوبر)', kind: 'fixed', m: 10, d: 6 },
  { market: 'egypt', ar: 'شم النسيم', kind: 'note', m: 4, note: 'يوم الاثنين بعد الفصح القبطي؛ التاريخ متغيّر، تأكد منه.' },
  { market: 'egypt', ar: 'موسم الصيف والساحل الشمالي', kind: 'note', m: 7 },
];

export async function seedEvents(db: Db) {
  const n = await db.one<{ c: number }>(`SELECT COUNT(*)::int AS c FROM events`);
  if (n && n.c > 0) return;
  for (const s of SEEDS) {
    await db.query(
      `INSERT INTO events (market,name_ar,name_en,kind,month,day,hijri_month,hijri_day,note,verified) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,FALSE)`,
      [s.market, s.ar, s.en ?? '', s.kind, s.kind === 'hijri' ? null : s.m ?? null, s.d ?? null, s.hm ?? null, s.hd ?? null, s.note ?? '']);
  }
}

function hijriOf(date: Date): { month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', { month: 'numeric', day: 'numeric', timeZone: 'UTC' }).formatToParts(date);
  return { month: Number(parts.find((p) => p.type === 'month')!.value), day: Number(parts.find((p) => p.type === 'day')!.value) };
}

export interface MonthEvent { id: number; name_ar: string; kind: string; date: string | null; note: string; verified: boolean }

export async function eventsForMonth(db: Db, market: string, month: string): Promise<MonthEvent[]> {
  const [y, m] = month.split('-').map(Number);
  const rows = await db.query<any>(`SELECT * FROM events WHERE market = ANY($1::text[])`, [marketsFor(market)]);
  const out: MonthEvent[] = [];
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const pad = (n: number) => String(n).padStart(2, '0');
  for (const e of rows) {
    if (e.kind === 'hijri') {
      for (let d = 1; d <= daysInMonth; d++) {
        const h = hijriOf(new Date(Date.UTC(y, m - 1, d)));
        if (h.month === e.hijri_month && h.day === e.hijri_day) {
          out.push({ id: e.id, name_ar: e.name_ar, kind: e.kind, date: `${y}-${pad(m)}-${pad(d)}`, note: e.note, verified: e.verified });
        }
      }
    } else if (e.month === m) {
      out.push({ id: e.id, name_ar: e.name_ar, kind: e.kind, date: e.day ? `${y}-${pad(m)}-${pad(e.day)}` : null, note: e.note, verified: e.verified });
    }
  }
  return out.sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999'));
}
