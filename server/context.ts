import { MARKETS } from './events.ts';
import type { MonthEvent } from './events.ts';

export const FORM_FIELDS: { key: string; label: string; hint: string; long?: boolean }[] = [
  { key: 'brand_name', label: 'اسم البراند', hint: 'الاسم كما يُكتب على السوشيال ميديا' },
  { key: 'industry', label: 'المجال', hint: 'مثال: مطعم، متجر ملابس، عيادة…' },
  { key: 'about', label: 'نبذة عن النشاط', hint: 'ماذا تقدّمون ولمن؟ منذ متى؟', long: true },
  { key: 'products_services', label: 'المنتجات / الخدمات الأساسية', hint: 'اذكر الأهم فقط', long: true },
  { key: 'target_audience', label: 'الجمهور المستهدف', hint: 'العمر، المدينة، الاهتمامات، من يشتري فعلًا؟', long: true },
  { key: 'goals', label: 'الهدف من المحتوى', hint: 'مبيعات؟ حجوزات؟ وعي؟ متابعين؟', long: true },
  { key: 'tone_voice', label: 'نبرة البراند', hint: 'رسمي، ودود، مرح، فخم… وأمثلة إن وجدت', long: true },
  { key: 'dialect', label: 'اللهجة المطلوبة', hint: 'خليجي، مصري، شامي، فصحى، إنجليزي…' },
  { key: 'offers_facts', label: 'عروض وأسعار وحقائق مؤكدة', hint: 'لن نذكر أي سعر أو عرض غير مكتوب هنا', long: true },
  { key: 'competitors', label: 'منافسون أو براندات تعجبك', hint: 'اختياري', long: true },
  { key: 'constraints', label: 'ممنوعات وحساسيات', hint: 'كلمات أو مواضيع تتجنبونها', long: true },
  { key: 'channels', label: 'المنصات', hint: 'Instagram, TikTok, Snapchat, X…' },
  { key: 'content_examples', label: 'أمثلة من محتواكم السابق', hint: 'روابط أو نصوص بوستات أعجبتكم (تساعد في ضبط النبرة)', long: true },
  { key: 'notes', label: 'أي شيء آخر', hint: 'اختياري', long: true },
];

export const requiredFormKeys = ['brand_name', 'industry', 'about', 'target_audience', 'goals'];

export function brandProfileText(brand: { name: string; market: string; form_data: Record<string, any> }): string {
  const d = brand.form_data || {};
  const lines = [`BRAND NAME: ${d.brand_name || brand.name}`, `MARKET: ${MARKETS[brand.market] || brand.market}`];
  for (const f of FORM_FIELDS) {
    if (f.key === 'brand_name') continue;
    const v = (d[f.key] ?? '').toString().trim();
    lines.push(`${f.label} (${f.key}): ${v || 'NOT PROVIDED'}`);
  }
  return lines.join('\n');
}

export function strategyForPlan(content: any): string {
  return [
    `DOWNSTREAM SUMMARY: ${content.downstream_summary}`,
    `POSITIONING: ${content.positioning}`,
    `TONE: ${content.tone?.description} | DO: ${(content.tone?.do || []).join('; ')} | DON'T: ${(content.tone?.dont || []).join('; ')}`,
    `CONTENT PILLARS: ${(content.content_pillars || []).map((p: any) => `${p.name} — ${p.description}`).join(' | ')}`,
    `GOALS: ${(content.goals || []).join('; ')}`,
    `KNOWN GAPS: ${(content.gaps || []).join('; ')}`,
  ].join('\n');
}

export function eventsText(events: MonthEvent[]): string {
  if (!events.length) return 'No occasions on file for this month and market.';
  return events.map((e) => `- ${e.name_ar}${e.date ? ` (${e.date})` : ' (during the month)'} [verified=${e.verified}]${e.note ? `: ${e.note}` : ''}`).join('\n');
}
