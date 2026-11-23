import crypto from 'node:crypto';
import type { Db } from './db.ts';
import { config } from './config.ts';
import { hashPassword, newToken } from './auth.ts';
import { ensureDefaultPrompts } from './prompts.ts';
import { seedEvents } from './events.ts';

const pick = (envVal: string | undefined, devDefault: string, label: string) => {
  if (envVal) return envVal;
  if (!config.isProd) return devDefault;
  const gen = crypto.randomBytes(9).toString('base64url');
  console.log(`[seed] ${label} password was not set; generated one (shown once): ${gen}`);
  return gen;
};

export function currentMonth(): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit' }).formatToParts(new Date());
  return `${parts.find((p) => p.type === 'year')!.value}-${parts.find((p) => p.type === 'month')!.value}`;
}

export async function seedAll(db: Db) {
  await ensureDefaultPrompts(db);
  await seedEvents(db);

  const hasAdmin = await db.one(`SELECT 1 AS x FROM users WHERE role='admin' LIMIT 1`);
  if (!hasAdmin) {
    const pw = pick(config.seedAdminPassword, 'admin12345', 'admin');
    await db.query(`INSERT INTO users (email,name,password_hash,role,credits) VALUES ($1,'الأدمن',$2,'admin',0)`, [config.seedAdminEmail, hashPassword(pw)]);
    console.log(`[seed] admin account: ${config.seedAdminEmail}`);
  }
  if (!config.seedDemo) return;
  const demoEmail = 'creator@duck.test';
  if (await db.one(`SELECT 1 AS x FROM users WHERE email=$1`, [demoEmail])) return;

  const pw = pick(process.env.DEMO_PASSWORD, 'creator12345', 'demo creator');
  const u = await db.one<{ id: number }>(
    `INSERT INTO users (email,name,password_hash,role,credits) VALUES ($1,'صانع محتوى تجريبي',$2,'creator',60) RETURNING id`, [demoEmail, hashPassword(pw)]);
  await db.query(`INSERT INTO credit_ledger (user_id, delta, reason) VALUES ($1,60,'رصيد ترحيبي للتجربة')`, [u!.id]);

  // Demo brand with hand-written sample content (clearly labelled demo; no AI involved).
  const formData = {
    brand_name: 'متجر السعادة (تجريبي)', industry: 'متجر هدايا وورود', about: 'متجر هدايا وباقات ورد في الكويت. هذا البراند للتجربة فقط وليس عميلًا حقيقيًا.',
    products_services: 'باقات ورد، صناديق هدايا، شوكولاتة', target_audience: 'شباب وعائلات في الكويت، يشترون للمناسبات والهدايا',
    goals: 'زيادة الطلبات في المناسبات', tone_voice: 'ودود وأنيق', dialect: 'خليجي (كويتي) بسيط', offers_facts: '', constraints: 'لا خصومات مذكورة', channels: 'Instagram, Snapchat',
  };
  const brand = await db.one<{ id: number }>(
    `INSERT INTO brands (owner_id,name,market,form_token,form_status,form_data) VALUES ($1,$2,'kuwait',$3,'submitted',$4) RETURNING id`,
    [u!.id, 'متجر السعادة (تجريبي)', newToken(), JSON.stringify(formData)]);
  const strat = {
    summary: 'استراتيجية تجريبية لعرض شكل النتيجة.', goals: ['زيادة الطلبات في المناسبات'], audience: [{ segment: 'شباب وعائلات', insight: 'يبحثون عن هدية جاهزة وسريعة' }],
    positioning: 'الهدية الجاهزة الأنيقة في الكويت', value_proposition: 'تغليف أنيق وتوصيل سريع', differentiation: 'تفاصيل التغليف', personality: ['ودود', 'أنيق'],
    tone: { description: 'قريب ودافئ', do: ['كلمات بسيطة'], dont: ['مبالغة'], examples: ['هديتك جاهزة، وبس تختار الكرت 💐'] },
    messaging_pillars: ['هدية بدون تعب'], content_pillars: [{ name: 'منتجات', description: 'عرض الباقات' }, { name: 'مناسبات', description: 'أفكار هدايا للمناسبات' }],
    channel_roles: [{ platform: 'Instagram', role: 'الواجهة' }], assumptions: ['بيانات تجريبية'], gaps: ['لا أسعار مذكورة'], downstream_summary: 'براند هدايا أنيق بنبرة دافئة، ركائز: منتجات ومناسبات. بدون ذكر أسعار.',
  };
  const s = await db.one<{ id: number }>(`INSERT INTO strategies (brand_id,version,content,status) VALUES ($1,1,$2,'approved') RETURNING id`, [brand!.id, JSON.stringify(strat)]);
  const month = currentMonth();
  const plan = await db.one<{ id: number }>(`INSERT INTO plans (brand_id,month,strategy_id) VALUES ($1,$2,$3) RETURNING id`, [brand!.id, month, s!.id]);
  const ideas = [
    ['باقة الهدية السريعة', 'carousel', 'مناسبات'], ['كواليس التغليف', 'reel_script', 'منتجات'], ['اختار هديتك حسب الشخصية', 'static_post', 'منتجات'],
    ['قصة عميل (تجريبية)', 'story', 'مناسبات'], ['صندوق الشتاء', 'caption', 'منتجات'], ['تذكير بالمناسبة القادمة', 'static_post', 'مناسبات'],
  ];
  const bodies: Record<string, any> = {
    carousel: { format: 'carousel', slides: [{ n: 1, headline: 'هدية جاهزة في دقيقتين', body: 'بدون تعب ولا تفكير.', visual_note: 'صورة الباقة' }, { n: 2, headline: 'اختر الحجم', body: 'ثلاثة أحجام تناسب كل مناسبة.', visual_note: '' }, { n: 3, headline: 'اطلب الآن', body: 'التوصيل داخل الكويت.', visual_note: '' }], caption: '[مثال تجريبي]', cta: 'اطلب الآن' },
    reel_script: { format: 'reel_script', hook: 'شلون نغلّف الهدية؟', scenes: [{ n: 1, visual: 'يد تغلف الصندوق', voiceover: 'من الورقة للشريطة…', on_screen_text: 'كواليس' }], cta: 'اطلب هديتك', duration_sec: 15 },
    static_post: { format: 'static_post', headline: 'هديتك تعرف شخصيتك', caption: '[مثال تجريبي] اختر الباقة اللي تشبه اللي تحبه.', cta: 'شوف الباقات', visual_note: 'صورة ثابتة' },
    story: { format: 'story', frames: [{ n: 1, copy: '[مثال تجريبي] رأي عميل', interaction: 'استطلاع' }], cta: 'اسحب للأعلى' },
    caption: { format: 'caption', caption: '[مثال تجريبي] دفا الشتاء في صندوق.', cta: 'اطلب الآن' },
  };
  const day = (n: number) => `${month}-${String(n).padStart(2, '0')}`;
  let i = 0;
  for (const [title, fmt, pillar] of ideas) {
    const idea = await db.one<{ id: number }>(
      `INSERT INTO ideas (plan_id,batch,title,concept,pillar,suggested_format,cta,rationale,selected) VALUES ($1,1,$2,'فكرة تجريبية',$3,$4,'اطلب الآن','مثال تجريبي',$5) RETURNING id`,
      [plan!.id, title, pillar, fmt, i < 4]);
    if (i < 4) await db.query(`INSERT INTO contents (idea_id,plan_id,format,body,schedule_date,platform) VALUES ($1,$2,$3,$4,$5,'Instagram')`, [idea!.id, plan!.id, fmt, JSON.stringify(bodies[fmt]), day(3 + i * 6)]);
    i++;
  }
  await db.query(`INSERT INTO calendars (plan_id,share_token,published) VALUES ($1,$2,TRUE)`, [plan!.id, newToken()]);
  console.log(`[seed] demo creator: ${demoEmail} (+ demo brand with a published calendar)`);
}
