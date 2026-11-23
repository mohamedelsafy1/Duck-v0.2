process.env.NODE_ENV = 'test';
process.env.AI_PROVIDER = 'stub';
process.env.SEED_DEMO = 'true';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';

const { openDb } = await import('../server/db.ts');
const { seedAll } = await import('../server/seed.ts');
const { createApp } = await import('../server/app.ts');
const { config } = await import('../server/config.ts');
const { eventsForMonth } = await import('../server/events.ts');

let server: Server; let base = ''; let db: Awaited<ReturnType<typeof openDb>>;

before(async () => {
  db = await openDb(); await seedAll(db);
  server = createApp(db).listen(0); base = `http://127.0.0.1:${(server.address() as any).port}`;
});
after(async () => { server.close(); await db.close(); });

class Client {
  cookie = '';
  async req(method: string, url: string, body?: any) {
    const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...(this.cookie ? { cookie: this.cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = r.headers.get('set-cookie'); if (set) this.cookie = set.split(';')[0];
    let json: any = null; try { json = await r.json(); } catch { /* none */ }
    return { status: r.status, json };
  }
  login(email: string, password: string) { return this.req('POST', '/api/auth/login', { email, password }); }
}
const creator = new Client(); const admin = new Client(); const other = new Client();
const credits = async (email: string) => (await db.one<{ credits: number }>(`SELECT credits FROM users WHERE email=$1`, [email]))!.credits;

test('auth: wrong password rejected, correct accepted, role gate enforced', async () => {
  assert.equal((await creator.login('creator@duck.test', 'nope-nope')).status, 401);
  assert.equal((await creator.login('creator@duck.test', 'creator12345')).status, 200);
  assert.equal((await admin.login('admin@duck.test', 'admin12345')).status, 200);
  assert.equal((await creator.req('GET', '/api/admin/users')).status, 403);
  assert.equal((await new Client().req('GET', '/api/brands')).status, 401);
});

let brandId = 0; let formToken = '';
test('journey gating: strategy needs the form, plan needs an approved strategy', async () => {
  const b = await creator.req('POST', '/api/brands', { name: 'متجر السعادة الاختباري', market: 'kuwait' });
  assert.equal(b.status, 201); brandId = b.json.brand.id; formToken = b.json.brand.form_token;
  assert.equal((await creator.req('POST', `/api/brands/${brandId}/strategy`, {})).status, 400);
  // client fills the form through the magic link (no account)
  const put = await new Client().req('PUT', `/api/public/form/${formToken}`, { form_data: { industry: 'هدايا', about: 'متجر هدايا', target_audience: 'شباب', goals: 'مبيعات', hacker: 'x' } });
  assert.equal(put.json.status, 'submitted');
  const got = await new Client().req('GET', `/api/public/form/${formToken}`);
  assert.equal(got.json.form_data.hacker, undefined, 'unknown fields must be dropped');
  assert.equal((await creator.req('POST', `/api/brands/${brandId}/plans/2027-02/generate`, {})).status, 400);
});

test('strategy → approve → plan with Show More appending, credits charged correctly', async () => {
  const start = await credits('creator@duck.test');
  const s = await creator.req('POST', `/api/brands/${brandId}/strategy`, {});
  assert.equal(s.status, 201); assert.equal(s.json.strategy.version, 1); assert.equal(s.json.cost, 3);
  assert.equal((await creator.req('POST', `/api/strategies/${s.json.strategy.id}/approve`)).status, 200);
  const p1 = await creator.req('POST', `/api/brands/${brandId}/plans/2027-02/generate`, { count: 24 });
  assert.equal(p1.status, 201); assert.equal(p1.json.ideas.length, 24);
  const p2 = await creator.req('POST', `/api/brands/${brandId}/plans/2027-02/generate`, { count: 5 });
  assert.equal(p2.json.ideas.length, 29, 'Show More must append, never replace');
  assert.deepEqual([...new Set(p2.json.ideas.map((i: any) => i.batch))], [1, 2]);
  assert.equal(await credits('creator@duck.test'), start - 3 - 5 - 5);
  assert.ok(p1.json.events.some((e: any) => e.name_ar.includes('رمضان')), 'Ramadan 1448 starts in Feb 2027');
  assert.ok(p1.json.events.some((e: any) => e.name_ar.includes('اليوم الوطني الكويتي')));
});

let calToken = ''; let contentId = 0; let planId = 0;
test('selection → content per idea → calendar → client review', async () => {
  const plan = await creator.req('GET', `/api/brands/${brandId}/plans/2027-02`);
  planId = plan.json.plan.id; const [a, b] = plan.json.ideas;
  await creator.req('PATCH', `/api/ideas/${a.id}`, { selected: true });
  const c1 = await creator.req('POST', `/api/ideas/${a.id}/content`, { format: 'carousel' });
  const c2 = await creator.req('POST', `/api/ideas/${b.id}/content`, { format: 'reel_script' });
  assert.equal(c1.status, 201); assert.equal(c2.status, 201);
  assert.equal(c1.json.content.body.format, 'carousel'); assert.ok(Array.isArray(c1.json.content.body.slides));
  assert.notEqual(c1.json.content.id, c2.json.content.id, 'content of different ideas stays separate');
  contentId = c1.json.content.id;
  const patched = await creator.req('PATCH', `/api/contents/${contentId}`, { schedule_date: '2027-02-10' });
  assert.equal(patched.json.content.schedule_date, '2027-02-10', 'dates must stay plain YYYY-MM-DD strings (no timezone drift)');
  assert.equal((await new Client().req('GET', '/api/public/calendar/not-a-token')).status, 404);
  const pub = await creator.req('POST', `/api/plans/${planId}/calendar`, { published: true });
  calToken = pub.json.calendar.share_token;
  const view = await new Client().req('GET', `/api/public/calendar/${calToken}`);
  assert.equal(view.status, 200); assert.equal(view.json.items.length, 2);
  assert.equal((await new Client().req('POST', `/api/public/calendar/${calToken}/review`, { content_id: contentId, mark: 'rejected', comment: 'النبرة رسمية' })).status, 200);
  assert.equal((await new Client().req('POST', `/api/public/calendar/${calToken}/review`, { content_id: 999999, mark: 'approved' })).status, 404);
  const after = await creator.req('GET', `/api/brands/${brandId}/plans/2027-02`);
  assert.equal(after.json.contents.find((c: any) => c.id === contentId).review.mark, 'rejected');
  // unpublishing closes the link
  await creator.req('POST', `/api/plans/${planId}/calendar`, { published: false });
  assert.equal((await new Client().req('GET', `/api/public/calendar/${calToken}`)).status, 404);
});

test('learning loop: next month plan receives the client rejection', async () => {
  const seen: string[] = [];
  const { getProvider } = await import('../server/ai/provider.ts');
  const p = getProvider(); const orig = p.generate.bind(p);
  p.generate = async (r) => { seen.push(r.user); return orig(r); };
  try {
    await creator.req('POST', `/api/brands/${brandId}/plans/2027-03/generate`, { count: 5 });
  } finally { p.generate = orig; }
  assert.ok(seen[0].includes('PAST FEEDBACK') && seen[0].includes('النبرة رسمية'));
});

test('tenant isolation: another creator cannot read or change this brand', async () => {
  await admin.req('POST', '/api/admin/users', { email: 'b@duck.test', name: 'B', password: 'password123', credits: 10 });
  await other.login('b@duck.test', 'password123');
  assert.equal((await other.req('GET', `/api/brands/${brandId}`)).status, 404);
  assert.equal((await other.req('POST', `/api/brands/${brandId}/strategy`, {})).status, 404);
  assert.equal((await other.req('PATCH', `/api/contents/${contentId}`, { platform: 'x' })).status, 404);
  assert.equal(((await other.req('GET', '/api/brands')).json.brands).length, 0);
});

test('credits: insufficient balance is refused; provider failure charges nothing', async () => {
  const c = new Client(); await c.login('b@duck.test', 'password123');
  const nb = await c.req('POST', '/api/brands', { name: 'B brand' });
  await c.req('PATCH', `/api/brands/${nb.json.brand.id}`, { form_data: { industry: 'x', about: 'x', target_audience: 'x', goals: 'x' } });
  await admin.req('POST', `/api/admin/users/${(await db.one<any>(`SELECT id FROM users WHERE email='b@duck.test'`)).id}/credits`, { delta: -9 });
  assert.equal((await c.req('POST', `/api/brands/${nb.json.brand.id}/strategy`, {})).status, 402);
  await admin.req('POST', `/api/admin/users/${(await db.one<any>(`SELECT id FROM users WHERE email='b@duck.test'`)).id}/credits`, { delta: 9 });
  const before = await credits('b@duck.test');
  (config as any).aiProvider = 'gemini'; (config as any).geminiApiKey = '';
  try {
    const r = await c.req('POST', `/api/brands/${nb.json.brand.id}/strategy`, {});
    assert.equal(r.status, 503); assert.match(r.json.error, /GEMINI_API_KEY/);
  } finally { (config as any).aiProvider = 'stub'; }
  assert.equal(await credits('b@duck.test'), before, 'no credit may be charged when the call fails');
  const err = await db.one<any>(`SELECT status FROM runs WHERE brand_id=$1 ORDER BY id DESC LIMIT 1`, [nb.json.brand.id]);
  assert.equal(err.status, 'error', 'failed runs are preserved for troubleshooting');
});

test('admin: new prompt version becomes active and is recorded on the run', async () => {
  const st = await admin.req('POST', '/api/admin/prompts/content_writer', { content: 'You are a test writer. '.repeat(5), note: 'اختبار' });
  assert.equal(st.json.version, 2);
  const plan = await creator.req('GET', `/api/brands/${brandId}/plans/2027-02`);
  await creator.req('POST', `/api/ideas/${plan.json.ideas[2].id}/content`, { format: 'caption' });
  const run = await db.one<any>(`SELECT prompt_version FROM runs WHERE stage='content_writer' ORDER BY id DESC LIMIT 1`);
  assert.equal(run.prompt_version, 2);
  assert.equal((await admin.req('POST', '/api/admin/prompts/content_writer/activate', { version: 1 })).status, 200);
  const list = await admin.req('GET', '/api/admin/prompts');
  assert.equal(list.json.stages.find((s: any) => s.key === 'content_writer').versions.find((v: any) => v.active).version, 1);
  assert.equal((await admin.req('POST', '/api/admin/prompts/nonsense', { content: 'x'.repeat(30) })).status, 400);
});

test('events: Hijri occasions are computed per year, unverified by default', async () => {
  const feb = await eventsForMonth(db, 'egypt', '2027-02');
  const ram = feb.find((e) => e.name_ar === 'بداية رمضان');
  assert.ok(ram && ram.date!.startsWith('2027-02'));
  assert.equal(ram!.verified, false);
  const eg = await eventsForMonth(db, 'egypt', '2027-07');
  assert.ok(eg.some((e) => e.name_ar.includes('23 يوليو')));
  const kw = await eventsForMonth(db, 'kuwait', '2027-07');
  assert.ok(!kw.some((e) => e.name_ar.includes('23 يوليو')), 'market-specific occasions must not leak to other markets');
});
