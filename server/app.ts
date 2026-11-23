import express, { type NextFunction, type Request, type Response } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { Db } from './db.ts';
import { config } from './config.ts';
import { authMiddleware, clearThrottle, createSession, destroySession, hashPassword, loginThrottled, newToken, requireAdmin, requireUser, verifyPassword, type AuthUser } from './auth.ts';
import { HttpError, runStage, getCosts, DEFAULT_COSTS } from './pipeline.ts';
import { FORMATS, FORMAT_LABELS, STAGES, STAGE_LABELS, activatePromptVersion, contentSchema, planSchema, readDefault, savePromptVersion, strategySchema, voiceSchema, type Stage } from './prompts.ts';
import { brandProfileText, eventsText, FORM_FIELDS, requiredFormKeys, strategyForPlan } from './context.ts';
import { MARKETS, eventsForMonth } from './events.ts';
import { currentMonth } from './seed.ts';
import { getProvider } from './ai/provider.ts';

type H = (req: Request, res: Response) => Promise<any>;
const wrap = (fn: H) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);
const id = (v: any) => { const n = Number(v); if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'معرّف غير صالح.'); return n; };
const monthRe = /^\d{4}-(0[1-9]|1[0-2])$/;
const parse = <T>(schema: z.ZodType<T, any, any>, body: unknown): T => {
  const r = schema.safeParse(body);
  if (!r.success) throw new HttpError(400, `بيانات غير صالحة: ${r.error.issues.slice(0, 3).map((i) => `${i.path.join('.') || 'body'} ${i.message}`).join('، ')}`);
  return r.data;
};

// light per-IP limiter for unauthenticated endpoints
const hits = new Map<string, { n: number; t: number }>();
const publicLimit = (max = 40) => (req: Request, res: Response, next: NextFunction) => {
  const k = `${req.ip}:${req.path.split('/')[2] ?? ''}`; const now = Date.now(); const h = hits.get(k);
  if (!h || now - h.t > 60_000) { hits.set(k, { n: 1, t: now }); return next(); }
  if (++h.n > max) return void res.status(429).json({ error: 'طلبات كثيرة، حاول بعد دقيقة.' });
  next();
};

export function createApp(db: Db) {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(express.json({ limit: '14mb' }));
  app.use((_req, res, next) => { res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'same-origin'); res.setHeader('X-Frame-Options', 'SAMEORIGIN'); next(); });
  app.use('/api', authMiddleware(db));

  const api = express.Router();
  const secureCookie = () => config.isProd;

  // ---------- meta ----------
  api.get('/meta', (_req, res) => res.json({ markets: MARKETS, formFields: FORM_FIELDS, formats: FORMATS.map((k) => ({ key: k, label: FORMAT_LABELS[k] })), stages: STAGES.map((k) => ({ key: k, label: STAGE_LABELS[k] })), currentMonth: currentMonth() }));

  // ---------- auth ----------
  api.post('/auth/login', wrap(async (req, res) => {
    const { email, password } = parse(z.object({ email: z.string().email(), password: z.string().min(1) }), req.body);
    const key = `${req.ip}|${email.toLowerCase()}`;
    if (loginThrottled(key)) throw new HttpError(429, 'محاولات كثيرة. حاول بعد 15 دقيقة.');
    const u = await db.one<any>(`SELECT * FROM users WHERE lower(email)=lower($1)`, [email]);
    if (!u || !u.active || !verifyPassword(password, u.password_hash)) throw new HttpError(401, 'البريد أو كلمة المرور غير صحيحة.');
    clearThrottle(key);
    await createSession(db, res, u.id, secureCookie());
    res.json({ user: { id: u.id, email: u.email, name: u.name, role: u.role, credits: u.credits } });
  }));
  api.post('/auth/logout', wrap(async (req, res) => { await destroySession(db, req, res); res.json({ ok: true }); }));
  api.get('/auth/me', (req, res) => res.json({ user: req.user ?? null }));

  // ---------- creator: brands ----------
  const ownBrand = async (req: Request, brandId: number) => {
    const b = await db.one<any>(`SELECT * FROM brands WHERE id=$1 AND (owner_id=$2 OR $3)`, [brandId, req.user!.id, req.user!.role === 'admin']);
    if (!b) throw new HttpError(404, 'البروفايل غير موجود.');
    return b;
  };
  const ownerOf = async (brand: any): Promise<AuthUser> => (await db.one<AuthUser>(`SELECT id,email,name,role,credits FROM users WHERE id=$1`, [brand.owner_id]))!;

  api.get('/brands', requireUser, wrap(async (req, res) => {
    const rows = await db.query(
      `SELECT b.id,b.name,b.market,b.form_status,b.created_at,
        (SELECT status FROM strategies s WHERE s.brand_id=b.id ORDER BY version DESC LIMIT 1) AS strategy_status,
        (SELECT COUNT(*)::int FROM plans p WHERE p.brand_id=b.id) AS plans
       FROM brands b WHERE b.owner_id=$1 ORDER BY b.created_at DESC`, [req.user!.id]);
    res.json({ brands: rows });
  }));

  api.post('/brands', requireUser, wrap(async (req, res) => {
    const { name, market } = parse(z.object({ name: z.string().trim().min(1).max(120), market: z.string().default('gulf') }), req.body);
    if (!MARKETS[market]) throw new HttpError(400, 'سوق غير معروف.');
    const b = await db.one<any>(`INSERT INTO brands (owner_id,name,market,form_token,form_data) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [req.user!.id, name, market, newToken(), JSON.stringify({ brand_name: name })]);
    res.status(201).json({ brand: b });
  }));

  api.get('/brands/:id', requireUser, wrap(async (req, res) => {
    const b = await ownBrand(req, id(req.params.id));
    const strategies = await db.query(`SELECT id,version,status,feedback,content,created_at FROM strategies WHERE brand_id=$1 ORDER BY version DESC`, [b.id]);
    const plans = await db.query(`SELECT p.id,p.month,(SELECT COUNT(*)::int FROM ideas i WHERE i.plan_id=p.id) AS ideas,(SELECT COUNT(*)::int FROM contents c WHERE c.plan_id=p.id) AS contents FROM plans p WHERE brand_id=$1 ORDER BY month DESC`, [b.id]);
    res.json({ brand: b, strategies, plans });
  }));

  api.patch('/brands/:id', requireUser, wrap(async (req, res) => {
    const b = await ownBrand(req, id(req.params.id));
    const body = parse(z.object({ name: z.string().trim().min(1).max(120).optional(), market: z.string().optional(), form_data: z.record(z.string()).optional() }), req.body);
    if (body.market && !MARKETS[body.market]) throw new HttpError(400, 'سوق غير معروف.');
    const form = body.form_data ? { ...b.form_data, ...body.form_data } : b.form_data;
    const filled = requiredFormKeys.every((k) => (form[k] ?? '').toString().trim());
    const status = body.form_data ? (filled ? 'submitted' : 'draft') : b.form_status;
    const u = await db.one(`UPDATE brands SET name=COALESCE($2,name), market=COALESCE($3,market), form_data=$4, form_status=$5, updated_at=now() WHERE id=$1 RETURNING *`, [b.id, body.name ?? null, body.market ?? null, JSON.stringify(form), status]);
    res.json({ brand: u });
  }));

  api.delete('/brands/:id', requireUser, wrap(async (req, res) => { const b = await ownBrand(req, id(req.params.id)); await db.query(`DELETE FROM brands WHERE id=$1`, [b.id]); res.json({ ok: true }); }));

  api.post('/brands/:id/rotate-form-link', requireUser, wrap(async (req, res) => {
    const b = await ownBrand(req, id(req.params.id));
    const u = await db.one<any>(`UPDATE brands SET form_token=$2 WHERE id=$1 RETURNING form_token`, [b.id, newToken()]);
    res.json({ form_token: u.form_token });
  }));

  const audioSchema = z.object({ mimeType: z.string().regex(/^audio\/[\w.+-]+(;.*)?$/), dataBase64: z.string().min(100).max(13_000_000) });
  const voiceExtract = async (brand: any, audio: z.infer<typeof audioSchema>) => {
    const owner = await ownerOf(brand);
    const r = await runStage(db, { user: owner, brandId: brand.id, stage: 'form_from_voice', schema: voiceSchema, audio: { mimeType: audio.mimeType.split(';')[0], dataBase64: audio.dataBase64 },
      userMessage: `Fill the brand form from the attached voice recording. The brand is called "${brand.name}" and targets the ${MARKETS[brand.market] || brand.market} market.` });
    return r.data;
  };
  api.post('/brands/:id/form/audio', requireUser, wrap(async (req, res) => {
    const b = await ownBrand(req, id(req.params.id));
    res.json(await voiceExtract(b, parse(audioSchema, req.body)));
  }));

  // ---------- strategy ----------
  api.post('/brands/:id/strategy', requireUser, wrap(async (req, res) => {
    const b = await ownBrand(req, id(req.params.id));
    const { feedback } = parse(z.object({ feedback: z.string().max(3000).optional() }), req.body ?? {});
    if (!requiredFormKeys.every((k) => (b.form_data[k] ?? '').toString().trim())) throw new HttpError(400, 'أكمل الحقول الأساسية في الفورم أولًا (الاسم، المجال، النبذة، الجمهور، الهدف).');
    const prev = await db.one<any>(`SELECT * FROM strategies WHERE brand_id=$1 ORDER BY version DESC LIMIT 1`, [b.id]);
    let msg = `BRAND PROFILE (everything the client told us):\n${brandProfileText(b)}`;
    if (feedback && prev) msg += `\n\nPREVIOUS STRATEGY (version ${prev.version}):\n${JSON.stringify(prev.content)}\n\nCORRECTION REQUESTED BY THE CREATOR/CLIENT:\n${feedback}\nProduce a revised full strategy.`;
    const r = await runStage(db, { user: req.user!, brandId: b.id, stage: 'brand_strategy', schema: strategySchema, userMessage: msg });
    const s = await db.one<any>(`INSERT INTO strategies (brand_id,version,content,feedback,run_id) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [b.id, (prev?.version ?? 0) + 1, JSON.stringify(r.data), feedback ?? null, r.runId]);
    res.status(201).json({ strategy: s, creditsLeft: r.creditsLeft, cost: r.cost });
  }));

  api.post('/strategies/:id/approve', requireUser, wrap(async (req, res) => {
    const s = await db.one<any>(`SELECT s.* FROM strategies s JOIN brands b ON b.id=s.brand_id WHERE s.id=$1 AND (b.owner_id=$2 OR $3)`, [id(req.params.id), req.user!.id, req.user!.role === 'admin']);
    if (!s) throw new HttpError(404, 'الاستراتيجية غير موجودة.');
    await db.query(`UPDATE strategies SET status = CASE WHEN id=$1 THEN 'approved' ELSE 'draft' END WHERE brand_id=$2`, [s.id, s.brand_id]);
    res.json({ ok: true });
  }));

  // ---------- plans / ideas ----------
  const planPayload = async (brandId: number, month: string) => {
    const brand = await db.one<any>(`SELECT id,name,market FROM brands WHERE id=$1`, [brandId]);
    const plan = await db.one<any>(`SELECT * FROM plans WHERE brand_id=$1 AND month=$2`, [brandId, month]);
    const events = await eventsForMonth(db, brand.market, month);
    if (!plan) return { plan: null, ideas: [], contents: [], calendar: null, events };
    const ideas = await db.query(`SELECT * FROM ideas WHERE plan_id=$1 ORDER BY batch, id`, [plan.id]);
    const contents = await db.query(`SELECT c.*, (SELECT row_to_json(r) FROM (SELECT mark, comment, created_at FROM reviews WHERE content_id=c.id ORDER BY id DESC LIMIT 1) r) AS review FROM contents c WHERE plan_id=$1 ORDER BY schedule_date NULLS LAST, id`, [plan.id]);
    const calendar = await db.one(`SELECT share_token, published FROM calendars WHERE plan_id=$1`, [plan.id]);
    return { plan, ideas, contents, calendar, events };
  };

  api.get('/brands/:id/plans/:month', requireUser, wrap(async (req, res) => {
    const b = await ownBrand(req, id(req.params.id));
    if (!monthRe.test(req.params.month)) throw new HttpError(400, 'شهر غير صالح (YYYY-MM).');
    res.json(await planPayload(b.id, req.params.month));
  }));

  api.post('/brands/:id/plans/:month/generate', requireUser, wrap(async (req, res) => {
    const b = await ownBrand(req, id(req.params.id));
    const month = req.params.month; if (!monthRe.test(month)) throw new HttpError(400, 'شهر غير صالح (YYYY-MM).');
    const { count } = parse(z.object({ count: z.number().int().min(5).max(30).default(24) }), req.body ?? {});
    const strat = await db.one<any>(`SELECT * FROM strategies WHERE brand_id=$1 AND status='approved' LIMIT 1`, [b.id]);
    if (!strat) throw new HttpError(400, 'اعتمد استراتيجية البراند أولًا قبل توليد الأفكار.');
    let plan = await db.one<any>(`SELECT * FROM plans WHERE brand_id=$1 AND month=$2`, [b.id, month]);
    if (!plan) plan = await db.one<any>(`INSERT INTO plans (brand_id,month,strategy_id) VALUES ($1,$2,$3) RETURNING *`, [b.id, month, strat.id]);
    const existing = await db.query<{ title: string; batch: number }>(`SELECT title,batch FROM ideas WHERE plan_id=$1`, [plan.id]);
    const batch = existing.length ? Math.max(...existing.map((e) => e.batch)) + 1 : 1;
    const events = await eventsForMonth(db, b.market, month);
    // learning loop: what the client rejected or asked to change in the last 3 reviewed months for this brand
    const fb = await db.query<any>(
      `SELECT i.title, r.mark, r.comment FROM reviews r JOIN contents c ON c.id=r.content_id JOIN ideas i ON i.id=c.idea_id JOIN plans p ON p.id=c.plan_id
       WHERE p.brand_id=$1 AND r.mark IN ('rejected','changes') AND p.month <> $2 ORDER BY r.id DESC LIMIT 12`, [b.id, month]);
    let msg = `COUNT:${count}\nBATCH:${batch}\nTarget month: ${month}\nMarket: ${MARKETS[b.market]}\n\nBRAND PROFILE:\n${brandProfileText(b)}\n\nAPPROVED STRATEGY:\n${strategyForPlan(strat.content)}\n\nOCCASIONS AND SEASON NOTES FOR THIS MONTH:\n${eventsText(events)}\n\nGenerate exactly ${count} ideas.`;
    if (fb.length) msg += `\n\nPAST FEEDBACK FROM THE CLIENT ON THIS BRAND (avoid repeating these mistakes):\n${fb.map((f) => `- "${f.title}" → ${f.mark}${f.comment ? `: ${f.comment}` : ''}`).join('\n')}`;
    if (existing.length) msg += `\n\nALREADY GENERATED FOR THIS MONTH (do not repeat):\n${existing.map((e) => `- ${e.title}`).join('\n')}`;
    const r = await runStage(db, { user: req.user!, brandId: b.id, stage: 'monthly_plan', schema: planSchema, userMessage: msg });
    for (const it of r.data.ideas) {
      const fmt = (FORMATS as readonly string[]).includes(it.suggested_format) ? it.suggested_format : 'static_post';
      await db.query(`INSERT INTO ideas (plan_id,batch,title,concept,pillar,suggested_format,cta,rationale,occasion) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [plan.id, batch, it.title, it.concept, it.pillar, fmt, it.cta, it.rationale, it.occasion]);
    }
    await db.query(`UPDATE plans SET notes=$2 WHERE id=$1`, [plan.id, r.data.season_notes]);
    res.status(201).json({ ...(await planPayload(b.id, month)), creditsLeft: r.creditsLeft, cost: r.cost });
  }));

  const ownIdea = async (req: Request, ideaId: number) => {
    const i = await db.one<any>(`SELECT i.*, p.brand_id, p.month FROM ideas i JOIN plans p ON p.id=i.plan_id JOIN brands b ON b.id=p.brand_id WHERE i.id=$1 AND (b.owner_id=$2 OR $3)`, [ideaId, req.user!.id, req.user!.role === 'admin']);
    if (!i) throw new HttpError(404, 'الفكرة غير موجودة.');
    return i;
  };
  api.patch('/ideas/:id', requireUser, wrap(async (req, res) => {
    const i = await ownIdea(req, id(req.params.id));
    const b = parse(z.object({ selected: z.boolean().optional(), title: z.string().min(1).max(300).optional(), concept: z.string().max(3000).optional() }), req.body);
    const u = await db.one(`UPDATE ideas SET selected=COALESCE($2,selected), title=COALESCE($3,title), concept=COALESCE($4,concept) WHERE id=$1 RETURNING *`, [i.id, b.selected ?? null, b.title ?? null, b.concept ?? null]);
    res.json({ idea: u });
  }));
  api.delete('/ideas/:id', requireUser, wrap(async (req, res) => { const i = await ownIdea(req, id(req.params.id)); await db.query(`DELETE FROM ideas WHERE id=$1`, [i.id]); res.json({ ok: true }); }));

  // ---------- content ----------
  const generateContent = async (req: Request, idea: any, format: string, platform: string) => {
    if (!(FORMATS as readonly string[]).includes(format)) throw new HttpError(400, 'صيغة غير معروفة.');
    const b = await db.one<any>(`SELECT * FROM brands WHERE id=$1`, [idea.brand_id]);
    const strat = await db.one<any>(`SELECT * FROM strategies WHERE brand_id=$1 AND status='approved' LIMIT 1`, [b.id]);
    if (!strat) throw new HttpError(400, 'لا توجد استراتيجية معتمدة.');
    const msg = `FORMAT:${format}\nPLATFORM: ${platform || 'Instagram'}\n\nBRAND PROFILE:\n${brandProfileText(b)}\n\nAPPROVED STRATEGY:\n${strategyForPlan(strat.content)}\n\nSELECTED IDEA:\nTitle: ${idea.title}\nConcept: ${idea.concept}\nPillar: ${idea.pillar}\nCTA: ${idea.cta}\nOccasion: ${idea.occasion || '-'}\n\nWrite the finished ${FORMAT_LABELS[format]} now, as JSON following the contract with "format":"${format}".`;
    const r = await runStage(db, { user: req.user!, brandId: b.id, stage: 'content_writer', schema: contentSchema, userMessage: msg });
    return { body: { ...r.data, format }, runId: r.runId, creditsLeft: r.creditsLeft };
  };

  api.post('/ideas/:id/content', requireUser, wrap(async (req, res) => {
    const i = await ownIdea(req, id(req.params.id));
    const { format, platform } = parse(z.object({ format: z.string(), platform: z.string().max(40).default('Instagram') }), req.body);
    const g = await generateContent(req, i, format, platform);
    const c = await db.one(`INSERT INTO contents (idea_id,plan_id,format,body,platform,run_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [i.id, i.plan_id, format, JSON.stringify(g.body), platform, g.runId]);
    res.status(201).json({ content: c, creditsLeft: g.creditsLeft });
  }));

  const ownContent = async (req: Request, cid: number) => {
    const c = await db.one<any>(`SELECT c.*, i.title, i.concept, i.pillar, i.cta, i.occasion, p.brand_id FROM contents c JOIN ideas i ON i.id=c.idea_id JOIN plans p ON p.id=c.plan_id JOIN brands b ON b.id=p.brand_id WHERE c.id=$1 AND (b.owner_id=$2 OR $3)`, [cid, req.user!.id, req.user!.role === 'admin']);
    if (!c) throw new HttpError(404, 'المحتوى غير موجود.');
    return c;
  };
  api.post('/contents/:id/regenerate', requireUser, wrap(async (req, res) => {
    const c = await ownContent(req, id(req.params.id));
    const g = await generateContent(req, c, c.format, c.platform);
    const u = await db.one(`UPDATE contents SET body=$2, run_id=$3, updated_at=now() WHERE id=$1 RETURNING *`, [c.id, JSON.stringify(g.body), g.runId]);
    await db.query(`DELETE FROM reviews WHERE content_id=$1`, [c.id]);
    res.json({ content: u, creditsLeft: g.creditsLeft });
  }));
  api.patch('/contents/:id', requireUser, wrap(async (req, res) => {
    const c = await ownContent(req, id(req.params.id));
    const b = parse(z.object({ body: z.record(z.any()).optional(), schedule_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), platform: z.string().max(40).optional() }), req.body);
    const u = await db.one(`UPDATE contents SET body=COALESCE($2,body), schedule_date=CASE WHEN $3::boolean THEN $4::date ELSE schedule_date END, platform=COALESCE($5,platform), updated_at=now() WHERE id=$1 RETURNING *`,
      [c.id, b.body ? JSON.stringify({ ...b.body, format: c.format }) : null, b.schedule_date !== undefined, b.schedule_date ?? null, b.platform ?? null]);
    res.json({ content: u });
  }));
  api.delete('/contents/:id', requireUser, wrap(async (req, res) => { const c = await ownContent(req, id(req.params.id)); await db.query(`DELETE FROM contents WHERE id=$1`, [c.id]); res.json({ ok: true }); }));

  // ---------- calendar sharing ----------
  api.post('/plans/:id/calendar', requireUser, wrap(async (req, res) => {
    const { published } = parse(z.object({ published: z.boolean() }), req.body);
    const p = await db.one<any>(`SELECT p.* FROM plans p JOIN brands b ON b.id=p.brand_id WHERE p.id=$1 AND (b.owner_id=$2 OR $3)`, [id(req.params.id), req.user!.id, req.user!.role === 'admin']);
    if (!p) throw new HttpError(404, 'الخطة غير موجودة.');
    const ex = await db.one<any>(`SELECT * FROM calendars WHERE plan_id=$1`, [p.id]);
    const cal = ex
      ? await db.one<any>(`UPDATE calendars SET published=$2 WHERE plan_id=$1 RETURNING share_token, published`, [p.id, published])
      : await db.one<any>(`INSERT INTO calendars (plan_id,share_token,published) VALUES ($1,$2,$3) RETURNING share_token, published`, [p.id, newToken(), published]);
    res.json({ calendar: cal });
  }));

  // ---------- usage (creator sees cost per client) ----------
  api.get('/usage', requireUser, wrap(async (req, res) => {
    const perBrand = await db.query(`SELECT b.id AS brand_id, b.name, COALESCE(-SUM(l.delta),0)::int AS spent FROM brands b LEFT JOIN credit_ledger l ON l.brand_id=b.id AND l.delta<0 WHERE b.owner_id=$1 GROUP BY b.id,b.name ORDER BY spent DESC`, [req.user!.id]);
    const ledger = await db.query(`SELECT l.delta,l.reason,l.created_at,b.name AS brand FROM credit_ledger l LEFT JOIN brands b ON b.id=l.brand_id WHERE l.user_id=$1 ORDER BY l.id DESC LIMIT 40`, [req.user!.id]);
    res.json({ perBrand, ledger, costs: await getCosts(db) });
  }));

  // ---------- public (client, no account; token = access) ----------
  const pub = express.Router();
  pub.use(publicLimit());
  const brandByFormToken = async (t: string) => {
    const b = await db.one<any>(`SELECT * FROM brands WHERE form_token=$1`, [t]);
    if (!b) throw new HttpError(404, 'الرابط غير صالح أو انتهت صلاحيته.');
    return b;
  };
  pub.get('/form/:token', wrap(async (req, res) => { const b = await brandByFormToken(req.params.token); res.json({ name: b.name, market: b.market, status: b.form_status, form_data: b.form_data }); }));
  pub.put('/form/:token', wrap(async (req, res) => {
    const b = await brandByFormToken(req.params.token);
    const { form_data } = parse(z.object({ form_data: z.record(z.string().max(5000)) }), req.body);
    const allowed = new Set(FORM_FIELDS.map((f) => f.key));
    const clean = Object.fromEntries(Object.entries(form_data).filter(([k]) => allowed.has(k)));
    const merged = { ...b.form_data, ...clean };
    const filled = requiredFormKeys.every((k) => (merged[k] ?? '').toString().trim());
    await db.query(`UPDATE brands SET form_data=$2, form_status=$3, updated_at=now() WHERE id=$1`, [b.id, JSON.stringify(merged), filled ? 'submitted' : 'draft']);
    res.json({ ok: true, status: filled ? 'submitted' : 'draft' });
  }));
  pub.post('/form/:token/audio', publicLimit(8), wrap(async (req, res) => { const b = await brandByFormToken(req.params.token); res.json(await voiceExtract(b, parse(audioSchema, req.body))); }));

  pub.get('/calendar/:token', wrap(async (req, res) => {
    const cal = await db.one<any>(`SELECT cal.*, p.month, p.brand_id FROM calendars cal JOIN plans p ON p.id=cal.plan_id WHERE cal.share_token=$1 AND cal.published`, [req.params.token]);
    if (!cal) throw new HttpError(404, 'الرابط غير صالح أو لم يُنشر الجدول بعد.');
    const b = await db.one<any>(`SELECT name FROM brands WHERE id=$1`, [cal.brand_id]);
    const items = await db.query(`SELECT c.id,c.format,c.body,c.schedule_date,c.platform,i.title, (SELECT row_to_json(r) FROM (SELECT mark, comment FROM reviews WHERE content_id=c.id ORDER BY id DESC LIMIT 1) r) AS review FROM contents c JOIN ideas i ON i.id=c.idea_id WHERE c.plan_id=$1 ORDER BY c.schedule_date NULLS LAST, c.id`, [cal.plan_id]);
    res.json({ brand: b.name, month: cal.month, items });
  }));
  pub.post('/calendar/:token/review', wrap(async (req, res) => {
    const cal = await db.one<any>(`SELECT cal.plan_id FROM calendars cal WHERE cal.share_token=$1 AND cal.published`, [req.params.token]);
    if (!cal) throw new HttpError(404, 'الرابط غير صالح.');
    const { content_id, mark, comment } = parse(z.object({ content_id: z.number().int(), mark: z.enum(['approved', 'rejected', 'changes']), comment: z.string().max(1500).default('') }), req.body);
    const c = await db.one(`SELECT 1 AS x FROM contents WHERE id=$1 AND plan_id=$2`, [content_id, cal.plan_id]);
    if (!c) throw new HttpError(404, 'المحتوى غير موجود في هذا الجدول.');
    await db.query(`INSERT INTO reviews (content_id,mark,comment) VALUES ($1,$2,$3)`, [content_id, mark, comment]);
    res.json({ ok: true });
  }));
  api.use('/public', pub);

  // ---------- admin ----------
  const adm = express.Router();
  adm.use(requireUser, requireAdmin);

  adm.get('/health', wrap(async (_req, res) => {
    let ai = { ok: true, provider: config.aiProvider, model: config.geminiModel, error: '' };
    try { const p = getProvider(); ai.model = p.model; } catch (e: any) { ai = { ok: false, provider: config.aiProvider, model: config.geminiModel, error: e.message }; }
    res.json({ db: db.kind, ai, concurrency: config.aiConcurrency, dailyRunCap: config.dailyRunCap });
  }));

  adm.get('/users', wrap(async (_req, res) => {
    const users = await db.query(`SELECT u.id,u.email,u.name,u.role,u.credits,u.active,u.created_at,(SELECT COUNT(*)::int FROM brands b WHERE b.owner_id=u.id) AS brands,(SELECT COUNT(*)::int FROM runs r WHERE r.user_id=u.id AND r.status='ok') AS runs,(SELECT COALESCE(-SUM(delta),0)::int FROM credit_ledger l WHERE l.user_id=u.id AND l.delta<0) AS spent FROM users u ORDER BY u.id`);
    res.json({ users });
  }));
  adm.post('/users', wrap(async (req, res) => {
    const b = parse(z.object({ email: z.string().email(), name: z.string().min(1).max(100), password: z.string().min(8).max(100), role: z.enum(['admin', 'creator']).default('creator'), credits: z.number().int().min(0).max(100000).default(30) }), req.body);
    if (await db.one(`SELECT 1 AS x FROM users WHERE lower(email)=lower($1)`, [b.email])) throw new HttpError(409, 'هذا البريد مسجّل بالفعل.');
    const u = await db.one<any>(`INSERT INTO users (email,name,password_hash,role,credits) VALUES ($1,$2,$3,$4,$5) RETURNING id,email,name,role,credits`, [b.email, b.name, hashPassword(b.password), b.role, b.credits]);
    if (b.credits) await db.query(`INSERT INTO credit_ledger (user_id,delta,reason) VALUES ($1,$2,'رصيد ابتدائي من الأدمن')`, [u.id, b.credits]);
    res.status(201).json({ user: u });
  }));
  adm.patch('/users/:id', wrap(async (req, res) => {
    const uid = id(req.params.id);
    const b = parse(z.object({ active: z.boolean().optional(), name: z.string().min(1).optional(), password: z.string().min(8).max(100).optional() }), req.body);
    if (b.active === false && uid === req.user!.id) throw new HttpError(400, 'لا يمكنك تعطيل حسابك.');
    await db.query(`UPDATE users SET active=COALESCE($2,active), name=COALESCE($3,name), password_hash=COALESCE($4,password_hash) WHERE id=$1`, [uid, b.active ?? null, b.name ?? null, b.password ? hashPassword(b.password) : null]);
    if (b.active === false || b.password) await db.query(`DELETE FROM sessions WHERE user_id=$1`, [uid]);
    res.json({ ok: true });
  }));
  adm.post('/users/:id/credits', wrap(async (req, res) => {
    const uid = id(req.params.id);
    const b = parse(z.object({ delta: z.number().int().min(-100000).max(100000), reason: z.string().max(200).default('تعديل من الأدمن') }), req.body);
    const u = await db.one<any>(`UPDATE users SET credits=credits+$2 WHERE id=$1 AND credits+$2>=0 RETURNING credits`, [uid, b.delta]);
    if (!u) throw new HttpError(400, 'الرصيد لا يمكن أن يصبح سالبًا.');
    await db.query(`INSERT INTO credit_ledger (user_id,delta,reason) VALUES ($1,$2,$3)`, [uid, b.delta, b.reason]);
    res.json({ credits: u.credits });
  }));

  adm.get('/prompts', wrap(async (_req, res) => {
    const rows = await db.query<any>(`SELECT stage,version,content,note,active,created_at FROM prompts ORDER BY stage, version DESC`);
    res.json({ stages: STAGES.map((s) => ({ key: s, label: STAGE_LABELS[s], versions: rows.filter((r) => r.stage === s) })), defaults: Object.fromEntries(STAGES.map((s) => [s, readDefault(s)])) });
  }));
  const stageParam = (v: string): Stage => { if (!(STAGES as readonly string[]).includes(v)) throw new HttpError(400, 'مرحلة غير معروفة.'); return v as Stage; };
  adm.post('/prompts/:stage', wrap(async (req, res) => {
    const { content, note } = parse(z.object({ content: z.string().min(20).max(30000), note: z.string().max(300).default('') }), req.body);
    res.status(201).json({ version: await savePromptVersion(db, stageParam(req.params.stage), content, note, req.user!.id) });
  }));
  adm.post('/prompts/:stage/activate', wrap(async (req, res) => {
    const { version } = parse(z.object({ version: z.number().int() }), req.body);
    if (!(await activatePromptVersion(db, stageParam(req.params.stage), version))) throw new HttpError(404, 'النسخة غير موجودة.');
    res.json({ ok: true });
  }));
  adm.post('/prompts/:stage/reset-default', wrap(async (req, res) => {
    const st = stageParam(req.params.stage);
    res.status(201).json({ version: await savePromptVersion(db, st, readDefault(st), 'إعادة للنسخة الافتراضية من الملف', req.user!.id) });
  }));

  adm.get('/events', wrap(async (_req, res) => res.json({ events: await db.query(`SELECT * FROM events ORDER BY market, COALESCE(month, hijri_month), COALESCE(day, hijri_day)`) })));
  const eventSchema = z.object({ market: z.string().min(1), name_ar: z.string().min(1).max(200), name_en: z.string().max(200).default(''), kind: z.enum(['fixed', 'hijri', 'note']), month: z.number().int().min(1).max(12).nullable().default(null), day: z.number().int().min(1).max(31).nullable().default(null), hijri_month: z.number().int().min(1).max(12).nullable().default(null), hijri_day: z.number().int().min(1).max(30).nullable().default(null), note: z.string().max(1000).default(''), verified: z.boolean().default(false) });
  adm.post('/events', wrap(async (req, res) => {
    const e = parse(eventSchema, req.body);
    if (e.kind === 'hijri' && (!e.hijri_month || !e.hijri_day)) throw new HttpError(400, 'المناسبة الهجرية تحتاج شهر ويوم هجري.');
    if (e.kind !== 'hijri' && !e.month) throw new HttpError(400, 'حدد الشهر الميلادي.');
    const r = await db.one(`INSERT INTO events (market,name_ar,name_en,kind,month,day,hijri_month,hijri_day,note,verified,verified_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, CASE WHEN $10 THEN now() END) RETURNING *`, [e.market, e.name_ar, e.name_en, e.kind, e.month, e.day, e.hijri_month, e.hijri_day, e.note, e.verified]);
    res.status(201).json({ event: r });
  }));
  adm.patch('/events/:id', wrap(async (req, res) => {
    const e = parse(eventSchema.partial(), req.body);
    const cur = await db.one<any>(`SELECT * FROM events WHERE id=$1`, [id(req.params.id)]);
    if (!cur) throw new HttpError(404, 'غير موجود.');
    const m = { ...cur, ...e };
    const r = await db.one(`UPDATE events SET market=$2,name_ar=$3,name_en=$4,kind=$5,month=$6,day=$7,hijri_month=$8,hijri_day=$9,note=$10,verified=$11,verified_at=CASE WHEN $11 AND NOT $12 THEN now() ELSE verified_at END WHERE id=$1 RETURNING *`,
      [cur.id, m.market, m.name_ar, m.name_en, m.kind, m.month, m.day, m.hijri_month, m.hijri_day, m.note, m.verified, cur.verified]);
    res.json({ event: r });
  }));
  adm.delete('/events/:id', wrap(async (req, res) => { await db.query(`DELETE FROM events WHERE id=$1`, [id(req.params.id)]); res.json({ ok: true }); }));

  adm.get('/runs', wrap(async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    res.json({ runs: await db.query(`SELECT r.id,r.stage,r.prompt_version,r.model,r.status,r.error,r.latency_ms,r.cost_credits,r.created_at,u.email,b.name AS brand FROM runs r LEFT JOIN users u ON u.id=r.user_id LEFT JOIN brands b ON b.id=r.brand_id ORDER BY r.id DESC LIMIT $1`, [limit]) });
  }));
  adm.get('/runs/:id', wrap(async (req, res) => { const r = await db.one(`SELECT * FROM runs WHERE id=$1`, [id(req.params.id)]); if (!r) throw new HttpError(404, 'غير موجود.'); res.json({ run: r }); }));

  adm.get('/settings', wrap(async (_req, res) => res.json({ costs: await getCosts(db), defaults: DEFAULT_COSTS })));
  adm.put('/settings/costs', wrap(async (req, res) => {
    const b = parse(z.record(z.number().int().min(0).max(1000)), req.body);
    for (const [k, v] of Object.entries(b)) {
      if (!(k in DEFAULT_COSTS)) continue;
      await db.query(`INSERT INTO settings (key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`, [`cost_${k}`, String(v)]);
    }
    res.json({ costs: await getCosts(db) });
  }));
  api.use('/admin', adm);

  app.use('/api', api);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'غير موجود.' }));

  // ---------- static frontend ----------
  const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist, { maxAge: '1h', index: false }));
    app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) return void res.status(err.status).json({ error: err.message });
    if (err?.type === 'entity.too.large') return void res.status(413).json({ error: 'الملف كبير جدًا.' });
    if (err instanceof SyntaxError && 'body' in err) return void res.status(400).json({ error: 'JSON غير صالح.' });
    console.error('[error]', err);
    res.status(500).json({ error: 'حدث خطأ غير متوقع في السيرفر.' });
  });
  return app;
}
