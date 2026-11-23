import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { del, get, patch, post } from '../api.ts';
import { Button, Card, Empty, ErrorBox, Field, Input, Select, Spinner, Tag, Textarea, copyText, cx, monthLabel, useToast } from '../ui.tsx';
import { useAuth } from '../App.tsx';
import { BodyTree, CalendarGrid, MarkTag } from '../components/content.tsx';
import { VoiceRecorder, type VoiceResult } from '../components/voice.tsx';

const STEPS = [['form', '١. البيانات'], ['strategy', '٢. الاستراتيجية'], ['plan', '٣. خطة الشهر'], ['content', '٤. المحتوى'], ['calendar', '٥. الكالندر']] as const;
type Step = (typeof STEPS)[number][0];
const PLATFORMS = ['Instagram', 'TikTok', 'Snapchat', 'X', 'Facebook', 'LinkedIn'];

export function BrandPage() {
  const { id } = useParams(); const nav = useNavigate(); const toast = useToast();
  const { meta, setCredits, user } = useAuth();
  const [brand, setBrand] = useState<any>(null);
  const [strategies, setStrategies] = useState<any[]>([]);
  const [month, setMonth] = useState(meta?.currentMonth || '');
  const [planData, setPlanData] = useState<any>(null);
  const [costs, setCosts] = useState<Record<string, number>>({});
  const [step, setStep] = useState<Step>('form');
  const [error, setError] = useState<string | null>(null);

  const loadBrand = useCallback(async () => { const r = await get(`/api/brands/${id}`); setBrand(r.brand); setStrategies(r.strategies); return r; }, [id]);
  const loadPlan = useCallback(async () => { if (month) setPlanData(await get(`/api/brands/${id}/plans/${month}`)); }, [id, month]);
  useEffect(() => { loadBrand().then((r) => { const s = r.brand.form_status === 'submitted' ? (r.strategies.length ? 'plan' : 'strategy') : 'form'; setStep(s); }).catch((e) => setError(e.message)); get('/api/usage').then((u) => setCosts(u.costs)).catch(() => {}); }, [loadBrand]);
  useEffect(() => { loadPlan().catch((e) => setError(e.message)); }, [loadPlan]);

  const approved = strategies.find((s) => s.status === 'approved');
  const run = async <T,>(fn: () => Promise<T>, okMsg?: string): Promise<T | undefined> => {
    setError(null);
    try { const r: any = await fn(); if (r && 'creditsLeft' in r) setCredits(r.creditsLeft); if (okMsg) toast(okMsg); return r; } catch (e: any) { setError(e.message); toast(e.message, 'bad'); }
  };
  const cost = (k: string) => (user?.role === 'admin' || costs[k] === undefined ? '' : ` (${costs[k]} كريديت)`);

  if (error && !brand) return <ErrorBox error={error} />;
  if (!brand) return <div className="grid place-items-center py-20 text-muted"><Spinner /></div>;
  const needsMonth = step === 'plan' || step === 'content' || step === 'calendar';
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><Link to="/" className="text-xs text-muted hover:text-ink">← كل العملاء</Link><h1 className="text-2xl font-extrabold">{brand.name}</h1></div>
        <div className="flex items-center gap-2"><Tag tone="duck">{meta?.markets[brand.market]}</Tag>
          <Button variant="ghost" onClick={async () => { if (confirm('حذف هذا البروفايل بكل ما فيه نهائيًا؟')) { await del(`/api/brands/${brand.id}`); nav('/'); } }}>حذف</Button></div>
      </div>
      <nav aria-label="مراحل العمل" className="flex flex-wrap gap-2 rounded-2xl border border-line bg-white p-2">
        {STEPS.map(([k, label]) => <button key={k} onClick={() => setStep(k)} aria-current={step === k ? 'step' : undefined} className={cx('rounded-xl px-4 py-2 text-sm font-bold transition', step === k ? 'bg-ink text-white' : 'text-muted hover:bg-black/5')}>{label}{k === 'strategy' && approved && <span aria-hidden> ✓</span>}</button>)}
        {needsMonth && <div className="ms-auto flex items-center gap-2 pe-2"><span className="text-xs text-muted">الشهر</span><Input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className="!w-auto !py-1" /></div>}
      </nav>
      <ErrorBox error={error} />
      {step === 'form' && <FormStep brand={brand} onSaved={setBrand} run={run} onNext={() => setStep('strategy')} />}
      {step === 'strategy' && <StrategyStep brand={brand} strategies={strategies} run={run} cost={cost} reload={loadBrand} toForm={() => setStep('form')} next={() => setStep('plan')} />}
      {step === 'plan' && <PlanStep brand={brand} month={month} data={planData} approved={!!approved} run={run} cost={cost} reload={loadPlan} toStrategy={() => setStep('strategy')} next={() => setStep('content')} />}
      {step === 'content' && <ContentStep data={planData} run={run} cost={cost} reload={loadPlan} toPlan={() => setStep('plan')} next={() => setStep('calendar')} />}
      {step === 'calendar' && <CalendarStep month={month} data={planData} run={run} reload={loadPlan} />}
    </div>
  );
}

type RunFn = <T>(fn: () => Promise<T>, okMsg?: string) => Promise<T | undefined>;

// ---------------- Step 1: form ----------------
function FormStep({ brand, onSaved, run, onNext }: { brand: any; onSaved: (b: any) => void; run: RunFn; onNext: () => void }) {
  const { meta } = useAuth(); const toast = useToast();
  const [data, setData] = useState<Record<string, string>>(brand.form_data || {});
  const [busy, setBusy] = useState(false); const [voice, setVoice] = useState<VoiceResult | null>(null);
  const [token, setToken] = useState(brand.form_token);
  const link = `${location.origin}/f/${token}`;
  const save = async () => { setBusy(true); const r: any = await run(() => patch(`/api/brands/${brand.id}`, { form_data: data }), 'تم حفظ البيانات ✓'); setBusy(false); if (r) onSaved(r.brand); };
  const applyVoice = (r: VoiceResult) => { setVoice(r); setData((d) => { const n = { ...d }; for (const [k, v] of Object.entries(r.fields)) if (v && !(n[k] || '').trim()) n[k] = v; return n; }); };
  const status = brand.form_status;
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <Card><div className="space-y-4">
        <div className="flex items-center justify-between"><h2 className="font-extrabold">بيانات البراند</h2><Tag tone={status === 'submitted' ? 'ok' : status === 'draft' ? 'warn' : 'neutral'}>{status === 'submitted' ? 'مكتمل' : status === 'draft' ? 'ينقصه حقول أساسية' : 'فاضي'}</Tag></div>
        {meta?.formFields.map((f) => <Field key={f.key} label={f.label} hint={f.hint}>{f.long ? <Textarea value={data[f.key] || ''} onChange={(e) => setData({ ...data, [f.key]: e.target.value })} /> : <Input value={data[f.key] || ''} onChange={(e) => setData({ ...data, [f.key]: e.target.value })} />}</Field>)}
        <div className="flex gap-2"><Button onClick={save} busy={busy}>حفظ</Button>{status === 'submitted' && <Button variant="soft" onClick={onNext}>التالي: الاستراتيجية ←</Button>}</div>
      </div></Card>
      <div className="space-y-4">
        <Card><h3 className="font-extrabold">ابعت الفورم للعميل</h3><p className="mt-1 text-xs text-muted">العميل يملأ الفورم (كتابة أو صوت) من الرابط بدون حساب. ما يكتبه يظهر هنا تلقائيًا بعد تحديث الصفحة.</p>
          <div className="ltr mt-3 break-all rounded-xl bg-paper px-3 py-2 text-xs">{link}</div>
          <div className="mt-3 flex gap-2"><Button variant="soft" onClick={() => { copyText(link); toast('تم نسخ الرابط ✓'); }}>نسخ الرابط</Button>
            <Button variant="ghost" onClick={async () => { if (confirm('سيتوقف الرابط القديم عن العمل. متابعة؟')) { const r: any = await run(() => post(`/api/brands/${brand.id}/rotate-form-link`)); if (r) setToken(r.form_token); } }}>رابط جديد</Button></div></Card>
        <Card><h3 className="mb-2 font-extrabold">أو سجّل بصوتك</h3>
          <VoiceRecorder extract={(a) => post(`/api/brands/${brand.id}/form/audio`, a)} onResult={applyVoice} />
          {voice && <div className="mt-3 rounded-xl bg-duck/20 p-3 text-xs"><b>ما فهمناه:</b> {voice.transcript_summary}<br />راجع الحقول ثم اضغط حفظ.</div>}</Card>
      </div>
    </div>
  );
}

// ---------------- Step 2: strategy ----------------
function StrategyStep({ brand, strategies, run, cost, reload, toForm, next }: { brand: any; strategies: any[]; run: RunFn; cost: (k: string) => string; reload: () => Promise<any>; toForm: () => void; next: () => void }) {
  const [sel, setSel] = useState<number | null>(null); const [feedback, setFeedback] = useState(''); const [busy, setBusy] = useState<string | null>(null);
  const cur = strategies.find((s) => s.id === sel) || strategies[0];
  useEffect(() => setSel(null), [strategies.length]);
  if (brand.form_status !== 'submitted') return <Empty title="أكمل بيانات البراند أولًا" hint="نحتاج الاسم والمجال والنبذة والجمهور والهدف على الأقل."><Button onClick={toForm}>الذهاب للبيانات</Button></Empty>;
  const gen = async (fb?: string) => { setBusy('gen'); const r = await run(() => post(`/api/brands/${brand.id}/strategy`, fb ? { feedback: fb } : {}), 'تم توليد الاستراتيجية ✓'); setBusy(null); if (r) { setFeedback(''); await reload(); } };
  if (!cur) return <Empty title="لسه مفيش استراتيجية" hint="الاستراتيجية هي أساس الأفكار والمحتوى. هتراجعها وتعتمدها قبل الانتقال."><Button busy={busy === 'gen'} onClick={() => gen()}>توليد الاستراتيجية{cost('brand_strategy')}</Button></Empty>;
  const c = cur.content;
  const Sec = ({ title, children, open }: { title: string; children: React.ReactNode; open?: boolean }) => <details open={open} className="rounded-xl border border-line bg-white px-4 py-3"><summary className="cursor-pointer font-bold">{title}</summary><div className="mt-3 text-sm leading-7">{children}</div></details>;
  const List = ({ items }: { items: string[] }) => items?.length ? <ul className="list-disc space-y-1 ps-5">{items.map((x, i) => <li key={i}>{x}</li>)}</ul> : <span className="text-muted">—</span>;
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2"><h2 className="font-extrabold">الاستراتيجية — النسخة {cur.version}</h2><Tag tone={cur.status === 'approved' ? 'ok' : 'warn'}>{cur.status === 'approved' ? '✓ معتمدة' : 'بانتظار اعتمادك'}</Tag>
          {strategies.length > 1 && <Select value={cur.id} onChange={(e) => setSel(Number(e.target.value))} className="!w-auto !py-1">{strategies.map((s) => <option key={s.id} value={s.id}>النسخة {s.version}{s.status === 'approved' ? ' (معتمدة)' : ''}</option>)}</Select>}</div>
        <Sec title="الملخص والأهداف" open><p>{c.summary}</p><div className="mt-2 font-bold">الأهداف</div><List items={c.goals} /></Sec>
        <Sec title="الجمهور" open>{c.audience?.map((a: any, i: number) => <p key={i}><b>{a.segment}:</b> {a.insight}</p>)}</Sec>
        <Sec title="التموضع والقيمة والتمايز"><p><b>التموضع:</b> {c.positioning}</p><p><b>القيمة:</b> {c.value_proposition}</p><p><b>التمايز:</b> {c.differentiation}</p></Sec>
        <Sec title="الشخصية ونبرة الصوت" open><p>{c.tone?.description}</p><div className="mt-2 grid gap-3 sm:grid-cols-2"><div><div className="font-bold text-ok">افعل</div><List items={c.tone?.do} /></div><div><div className="font-bold text-bad">لا تفعل</div><List items={c.tone?.dont} /></div></div>{c.tone?.examples?.length > 0 && <div className="mt-2 font-bold">أمثلة</div>}<List items={c.tone?.examples} /></Sec>
        <Sec title="ركائز المحتوى" open>{c.content_pillars?.map((p: any, i: number) => <p key={i}><b>{p.name}:</b> {p.description}</p>)}</Sec>
        <Sec title="الرسائل الأساسية والمنصات"><List items={c.messaging_pillars} />{c.channel_roles?.map((p: any, i: number) => <p key={i}><b>{p.platform}:</b> {p.role}</p>)}</Sec>
        <Sec title="افتراضات ونواقص (راجعها)" open><div className="font-bold">افتراضات الموديل</div><List items={c.assumptions} /><div className="mt-2 font-bold">معلومات ناقصة</div><List items={c.gaps} /></Sec>
      </div>
      <div className="space-y-4">
        <Card><h3 className="font-extrabold">قرارك</h3>
          {cur.status !== 'approved' ? <Button className="mt-3 w-full" onClick={async () => { await run(() => post(`/api/strategies/${cur.id}/approve`), 'تم اعتماد الاستراتيجية ✓'); await reload(); }}>✓ اعتماد هذه النسخة</Button>
            : <Button className="mt-3 w-full" onClick={next}>التالي: خطة الشهر ←</Button>}
          <div className="mt-4 border-t border-line pt-4"><Field label="طلب تعديل" hint="اكتب ما يجب تغييره، وسنعيد توليد نسخة جديدة مع الحفاظ على القديمة."><Textarea value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="مثال: النبرة رسمية زيادة، والجمهور ناقص فئة العائلات" /></Field>
            <Button variant="soft" className="mt-2 w-full" disabled={!feedback.trim()} busy={busy === 'gen'} onClick={() => gen(feedback)}>إعادة توليد بالتعديل{cost('brand_strategy')}</Button></div></Card>
      </div>
    </div>
  );
}

// ---------------- Step 3: plan ----------------
function PlanStep({ brand, month, data, approved, run, cost, reload, toStrategy, next }: { brand: any; month: string; data: any; approved: boolean; run: RunFn; cost: (k: string) => string; reload: () => Promise<void>; toStrategy: () => void; next: () => void }) {
  const { meta } = useAuth();
  const [count, setCount] = useState(24); const [busy, setBusy] = useState(false);
  if (!approved) return <Empty title="اعتمد الاستراتيجية أولًا" hint="الأفكار تُبنى على استراتيجية معتمدة فقط."><Button onClick={toStrategy}>الذهاب للاستراتيجية</Button></Empty>;
  if (!data) return <div className="grid place-items-center py-16 text-muted"><Spinner /></div>;
  const ideas: any[] = data.ideas; const selected = ideas.filter((i) => i.selected).length;
  const gen = async (n: number) => { setBusy(true); await run(() => post(`/api/brands/${brand.id}/plans/${month}/generate`, { count: n }), 'تمت إضافة الأفكار ✓'); setBusy(false); await reload(); };
  const toggle = async (i: any) => { await run(() => patch(`/api/ideas/${i.id}`, { selected: !i.selected })); await reload(); };
  const batches = [...new Set(ideas.map((i) => i.batch))];
  return (
    <div className="space-y-4">
      <Card><div className="flex flex-wrap items-start justify-between gap-4">
        <div><h2 className="font-extrabold">مناسبات {monthLabel(month)} — {meta?.markets[brand.market] || brand.market}</h2><p className="text-xs text-muted">من قاعدة المواسم. العلامة «غير مؤكد» تعني أن التاريخ لم يراجعه الأدمن بعد، فتأكد منه قبل النشر.</p></div></div>
        <div className="mt-3 flex flex-wrap gap-2">{data.events.length === 0 ? <span className="text-sm text-muted">لا مناسبات مسجّلة لهذا الشهر.</span> : data.events.map((e: any) => <span key={e.id} title={e.note} className="rounded-xl border border-line bg-paper px-3 py-1.5 text-xs font-bold">{e.name_ar}{e.date && <span className="text-muted"> · {e.date.slice(8)}</span>} {!e.verified && <span className="text-warn">· غير مؤكد</span>}</span>)}</div></Card>
      {ideas.length === 0 ? <Empty title="جاهز لتوليد أفكار الشهر" hint="سيقترح النظام مجموعة أفكار مبنية على الاستراتيجية والموسم والسوق، وتختار منها ما يناسب خطتك.">
        <div className="flex items-end gap-3"><Field label="عدد الأفكار"><Input type="number" min={5} max={30} value={count} onChange={(e) => setCount(Number(e.target.value))} className="!w-24" /></Field><Button busy={busy} onClick={() => gen(count)}>توليد الأفكار{cost('monthly_plan')}</Button></div></Empty>
        : <>
          <div className="sticky top-16 z-20 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-white/95 px-4 py-3 backdrop-blur">
            <div className="font-bold">اخترت {selected} من {ideas.length} فكرة</div>
            <div className="flex gap-2"><Button variant="soft" busy={busy} onClick={() => gen(8)}>أفكار إضافية +8{cost('monthly_plan')}</Button><Button disabled={!selected} onClick={next}>التالي: كتابة المحتوى ←</Button></div></div>
          {data.plan?.notes && <p className="rounded-xl bg-duck/15 px-4 py-3 text-sm"><b>ملاحظات الموسم:</b> {data.plan.notes}</p>}
          {batches.map((b) => <div key={b}><h3 className="mb-2 text-sm font-bold text-muted">الدفعة {b}</h3><div className="grid gap-3 md:grid-cols-2">{ideas.filter((i) => i.batch === b).map((i) => (
            <label key={i.id} className={cx('flex cursor-pointer gap-3 rounded-2xl border-2 bg-white p-4 transition', i.selected ? 'border-ink' : 'border-line hover:border-muted')}>
              <input type="checkbox" checked={i.selected} onChange={() => toggle(i)} className="mt-1.5 h-5 w-5 accent-[#c98a06]" />
              <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="font-extrabold">{i.title}</span>{i.occasion && <Tag tone="duck">🗓 {i.occasion}</Tag>}</div>
                <p className="mt-1 text-sm">{i.concept}</p><div className="mt-2 flex flex-wrap gap-1.5 text-[11px]"><Tag>{i.pillar}</Tag><Tag>{meta?.formats.find((f) => f.key === i.suggested_format)?.label || i.suggested_format}</Tag></div>{i.rationale && <p className="mt-2 text-xs text-muted">{i.rationale}</p>}</div></label>))}</div></div>)}
        </>}
    </div>
  );
}

// ---------------- Step 4: content ----------------
function ContentStep({ data, run, cost, reload, toPlan, next }: { data: any; run: RunFn; cost: (k: string) => string; reload: () => Promise<void>; toPlan: () => void; next: () => void }) {
  const { meta } = useAuth();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [fmt, setFmt] = useState<Record<number, string>>({}); const [plat, setPlat] = useState<Record<number, string>>({});
  if (!data) return <div className="grid place-items-center py-16 text-muted"><Spinner /></div>;
  const ideas = (data.ideas as any[]).filter((i) => i.selected);
  if (!ideas.length) return <Empty title="اختر أفكارًا أولًا" hint="ارجع لخطة الشهر وعلّم على الأفكار التي ستنفذها."><Button onClick={toPlan}>خطة الشهر</Button></Empty>;
  const label = (k: string) => meta?.formats.find((f) => f.key === k)?.label || k;
  const make = async (i: any) => { setBusyId(`i${i.id}`); await run(() => post(`/api/ideas/${i.id}/content`, { format: fmt[i.id] || i.suggested_format, platform: plat[i.id] || 'Instagram' }), 'تم تجهيز المحتوى ✓'); setBusyId(null); await reload(); };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-extrabold">المحتوى ({ideas.length} فكرة مختارة)</h2><Button variant="soft" onClick={next}>التالي: الكالندر ←</Button></div>
      {ideas.map((i) => { const cs = (data.contents as any[]).filter((c) => c.idea_id === i.id); return (
        <Card key={i.id}><div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1"><div className="font-extrabold">{i.title}</div><p className="text-sm text-muted">{i.concept}</p></div>
          <div className="flex flex-wrap items-end gap-2">
            <Select value={fmt[i.id] || i.suggested_format} onChange={(e) => setFmt({ ...fmt, [i.id]: e.target.value })} className="!w-auto" aria-label="الصيغة">{meta?.formats.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}</Select>
            <Select value={plat[i.id] || 'Instagram'} onChange={(e) => setPlat({ ...plat, [i.id]: e.target.value })} className="!w-auto" aria-label="المنصة">{PLATFORMS.map((p) => <option key={p}>{p}</option>)}</Select>
            <Button busy={busyId === `i${i.id}`} onClick={() => make(i)}>اكتب{cost('content_writer')}</Button></div></div>
          {cs.length > 0 && <div className="mt-4 grid gap-3 lg:grid-cols-2">{cs.map((c) => <ContentCard key={c.id} c={c} label={label(c.format)} run={run} cost={cost} reload={reload} />)}</div>}
        </Card>); })}
    </div>
  );
}

function ContentCard({ c, label, run, cost, reload }: { c: any; label: string; run: RunFn; cost: (k: string) => string; reload: () => Promise<void> }) {
  const [edit, setEdit] = useState(false); const [body, setBody] = useState(c.body); const [busy, setBusy] = useState(false);
  useEffect(() => setBody(c.body), [c.body]);
  return (
    <div className="rounded-xl border border-line bg-paper/50 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><Tag tone="duck">{label} · {c.platform}</Tag><MarkTag mark={c.review?.mark} /></div>
      {c.review?.comment && <p className="mb-3 rounded-lg bg-warn-soft px-3 py-2 text-xs"><b>ملاحظة العميل:</b> {c.review.comment}</p>}
      <BodyTree value={body} onChange={edit ? setBody : undefined} />
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <Input type="date" value={c.schedule_date?.slice(0, 10) || ''} onChange={async (e) => { await run(() => patch(`/api/contents/${c.id}`, { schedule_date: e.target.value || null })); await reload(); }} className="!w-auto !py-1" aria-label="تاريخ النشر" />
        {edit ? <Button busy={busy} onClick={async () => { setBusy(true); await run(() => patch(`/api/contents/${c.id}`, { body }), 'تم الحفظ ✓'); setBusy(false); setEdit(false); await reload(); }}>حفظ</Button> : <Button variant="soft" onClick={() => setEdit(true)}>تعديل</Button>}
        <Button variant="ghost" busy={busy} onClick={async () => { setBusy(true); await run(() => post(`/api/contents/${c.id}/regenerate`), 'تمت إعادة الكتابة ✓'); setBusy(false); await reload(); }}>إعادة كتابة{cost('content_writer')}</Button>
        <Button variant="ghost" onClick={() => copyText(JSON.stringify(c.body, null, 2))}>نسخ</Button>
        <Button variant="danger" onClick={async () => { if (confirm('حذف هذا المحتوى؟')) { await run(() => del(`/api/contents/${c.id}`)); await reload(); } }}>حذف</Button>
      </div>
    </div>
  );
}

// ---------------- Step 5: calendar ----------------
function CalendarStep({ month, data, run, reload }: { month: string; data: any; run: RunFn; reload: () => Promise<void> }) {
  const { meta } = useAuth(); const toast = useToast();
  const [sel, setSel] = useState<number | null>(null);
  if (!data) return <div className="grid place-items-center py-16 text-muted"><Spinner /></div>;
  if (!data.plan || !data.contents.length) return <Empty title="لا يوجد محتوى في هذا الشهر بعد" hint="جهّز محتوى لبعض الأفكار ثم حدد تواريخ نشرها." />;
  const contents: any[] = data.contents; const cal = data.calendar;
  const link = cal ? `${location.origin}/c/${cal.share_token}` : '';
  const fl = (k: string) => meta?.formats.find((f) => f.key === k)?.label || k;
  const ideaTitle = (id: number) => data.ideas.find((i: any) => i.id === id)?.title || '';
  const items = contents.map((c) => ({ ...c, title: ideaTitle(c.idea_id), schedule_date: c.schedule_date?.slice(0, 10) || null }));
  const cur = items.find((i) => i.id === sel);
  const unscheduled = items.filter((i) => !i.schedule_date);
  const counts = { approved: 0, changes: 0, rejected: 0, none: 0 } as Record<string, number>; items.forEach((i) => counts[i.review?.mark || 'none']++);
  return (
    <div className="space-y-4">
      <Card><div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="font-extrabold">كالندر {monthLabel(month)}</h2><div className="mt-1 flex flex-wrap gap-2 text-xs font-bold"><span className="text-ok">✓ {counts.approved} موافق</span><span className="text-warn">✎ {counts.changes} تعديل</span><span className="text-bad">✕ {counts.rejected} مرفوض</span><span className="text-muted">{counts.none} بانتظار</span></div></div>
        <div className="flex flex-wrap items-center gap-2">
          {!cal?.published ? <Button onClick={async () => { await run(() => post(`/api/plans/${data.plan.id}/calendar`, { published: true }), 'تم نشر رابط العميل ✓'); await reload(); }}>نشر الكالندر للعميل</Button>
            : <><Button variant="soft" onClick={() => { copyText(link); toast('تم نسخ رابط العميل ✓'); }}>نسخ رابط العميل</Button><Button variant="ghost" onClick={async () => { await run(() => post(`/api/plans/${data.plan.id}/calendar`, { published: false }), 'تم إيقاف الرابط'); await reload(); }}>إيقاف الرابط</Button></>}
          <Button variant="ghost" onClick={() => reload()}>تحديث</Button></div></div>
        {cal?.published && <div className="ltr mt-3 break-all rounded-xl bg-paper px-3 py-2 text-xs">{link}</div>}</Card>
      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="space-y-3"><CalendarGrid month={month} items={items} selectedId={sel} onSelect={setSel} formatLabel={fl} />
          {unscheduled.length > 0 && <Card><div className="mb-2 text-sm font-bold">بدون تاريخ ({unscheduled.length})</div><div className="space-y-2">{unscheduled.map((i) => <div key={i.id} className="flex items-center justify-between gap-2 text-sm"><span>{fl(i.format)} · {i.title}</span><Input type="date" min={`${month}-01`} max={`${month}-31`} onChange={async (e) => { await run(() => patch(`/api/contents/${i.id}`, { schedule_date: e.target.value })); await reload(); }} className="!w-auto !py-1" aria-label="تاريخ النشر" /></div>)}</div></Card>}</div>
        <Card className="h-fit lg:sticky lg:top-20">{!cur ? <p className="py-8 text-center text-sm text-muted">اختر منشورًا لعرضه ورأي العميل فيه.</p> : <div className="space-y-3">
          <div className="flex items-start justify-between gap-2"><div><div className="text-xs font-bold text-muted">{fl(cur.format)} · {cur.platform} · {cur.schedule_date}</div><h3 className="font-extrabold">{cur.title}</h3></div><MarkTag mark={cur.review?.mark} /></div>
          {cur.review?.comment && <p className="rounded-lg bg-warn-soft px-3 py-2 text-xs"><b>ملاحظة العميل:</b> {cur.review.comment}</p>}
          <div className="max-h-[45vh] overflow-y-auto rounded-xl bg-paper/70 p-3"><BodyTree value={cur.body} /></div></div>}</Card>
      </div>
    </div>
  );
}
