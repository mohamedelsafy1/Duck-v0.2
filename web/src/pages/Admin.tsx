import React, { useCallback, useEffect, useState } from 'react';
import { del, get, patch, post, put } from '../api.ts';
import { Button, Card, ErrorBox, Field, Input, Modal, Select, Spinner, Tag, Textarea, cx, useToast } from '../ui.tsx';
import { useAuth } from '../App.tsx';

const TABS = [['users', 'المستخدمون والكريديت'], ['prompts', 'البرومتات'], ['events', 'المواسم والمناسبات'], ['runs', 'سجل التشغيل'], ['settings', 'الإعدادات']] as const;
type Tab = (typeof TABS)[number][0];

export function Admin() {
  const [tab, setTab] = useState<Tab>('users');
  const [health, setHealth] = useState<any>(null);
  useEffect(() => { get('/api/admin/health').then(setHealth).catch(() => {}); }, []);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-extrabold">لوحة الأدمن</h1>
        {health && <div className="flex flex-wrap gap-2 text-xs"><Tag tone={health.ai.ok ? 'ok' : 'bad'}>{health.ai.ok ? `الذكاء الاصطناعي: ${health.ai.provider} / ${health.ai.model}` : 'الذكاء الاصطناعي غير مضبوط'}</Tag><Tag tone={health.db === 'pg' ? 'ok' : 'warn'}>قاعدة البيانات: {health.db === 'pg' ? 'Postgres' : 'ملف محلي (مؤقت)'}</Tag></div>}</div>
      {health && !health.ai.ok && <ErrorBox error={health.ai.error} />}
      <nav className="flex flex-wrap gap-2 rounded-2xl border border-line bg-white p-2">{TABS.map(([k, l]) => <button key={k} onClick={() => setTab(k)} className={cx('rounded-xl px-4 py-2 text-sm font-bold', tab === k ? 'bg-ink text-white' : 'text-muted hover:bg-black/5')}>{l}</button>)}</nav>
      {tab === 'users' && <Users />}{tab === 'prompts' && <Prompts />}{tab === 'events' && <Events />}{tab === 'runs' && <Runs />}{tab === 'settings' && <Settings />}
    </div>
  );
}

function useLoad<T>(fn: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null); const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => { fn().then(setData).catch((e) => setError(e.message)); }, []);
  useEffect(reload, [reload]);
  return { data, error, reload };
}

function Users() {
  const toast = useToast(); const { user: me } = useAuth();
  const { data, error, reload } = useLoad(() => get('/api/admin/users'));
  const [open, setOpen] = useState(false); const [f, setF] = useState({ email: '', name: '', password: '', credits: 30, role: 'creator' }); const [err, setErr] = useState<string | null>(null);
  const act = async (fn: () => Promise<any>, ok: string) => { try { await fn(); toast(ok); reload(); } catch (e: any) { toast(e.message, 'bad'); } };
  if (!data) return error ? <ErrorBox error={error} /> : <Spinner />;
  return (
    <div className="space-y-4"><div className="flex justify-between"><p className="text-sm text-muted">أنشئ حسابات المجرّبين، وامنحهم كريديت مجاني لفترة التجربة.</p><Button onClick={() => setOpen(true)}>＋ مستخدم جديد</Button></div>
      <Card className="overflow-x-auto !p-0"><table className="w-full min-w-[720px] text-sm"><thead className="bg-paper text-xs text-muted"><tr>{['المستخدم', 'الدور', 'الرصيد', 'عملاء', 'عمليات ناجحة', 'استهلاك', ''].map((h) => <th key={h} className="px-4 py-3 text-start font-bold">{h}</th>)}</tr></thead>
        <tbody>{data.users.map((u: any) => <tr key={u.id} className="border-t border-line"><td className="px-4 py-3"><div className="font-bold">{u.name} {!u.active && <Tag tone="bad">معطّل</Tag>}</div><div className="ltr text-xs text-muted">{u.email}</div></td>
          <td className="px-4 py-3">{u.role === 'admin' ? 'أدمن' : 'صانع محتوى'}</td><td className="px-4 py-3 font-bold">{u.credits}</td><td className="px-4 py-3">{u.brands}</td><td className="px-4 py-3">{u.runs}</td><td className="px-4 py-3">{u.spent}</td>
          <td className="px-4 py-3"><div className="flex flex-wrap gap-1">
            <Button variant="soft" onClick={() => { const v = prompt('كم كريديت تضيف؟ (اكتب رقمًا سالبًا للخصم)', '30'); if (v && Number.isInteger(Number(v))) act(() => post(`/api/admin/users/${u.id}/credits`, { delta: Number(v), reason: 'تعديل من الأدمن' }), 'تم تعديل الرصيد ✓'); }}>رصيد</Button>
            <Button variant="ghost" onClick={() => { const v = prompt('كلمة مرور جديدة (8 أحرف على الأقل)'); if (v) act(() => patch(`/api/admin/users/${u.id}`, { password: v }), 'تم تغيير كلمة المرور ✓'); }}>كلمة المرور</Button>
            {u.id !== me?.id && <Button variant={u.active ? 'danger' : 'soft'} onClick={() => act(() => patch(`/api/admin/users/${u.id}`, { active: !u.active }), u.active ? 'تم التعطيل' : 'تم التفعيل')}>{u.active ? 'تعطيل' : 'تفعيل'}</Button>}</div></td></tr>)}</tbody></table></Card>
      {open && <Modal title="مستخدم جديد" onClose={() => setOpen(false)}><form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); setErr(null); try { await post('/api/admin/users', { ...f, credits: Number(f.credits) }); setOpen(false); setF({ email: '', name: '', password: '', credits: 30, role: 'creator' }); toast('تم إنشاء المستخدم ✓'); reload(); } catch (x: any) { setErr(x.message); } }}>
        <Field label="الاسم"><Input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="البريد"><Input required type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} className="ltr" /></Field>
        <Field label="كلمة المرور" hint="8 أحرف على الأقل"><Input required minLength={8} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} className="ltr" /></Field>
        <div className="grid grid-cols-2 gap-3"><Field label="الكريديت الابتدائي"><Input type="number" min={0} value={f.credits} onChange={(e) => setF({ ...f, credits: Number(e.target.value) })} /></Field><Field label="الدور"><Select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}><option value="creator">صانع محتوى</option><option value="admin">أدمن</option></Select></Field></div>
        <ErrorBox error={err} /><div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setOpen(false)}>إلغاء</Button><Button type="submit">إنشاء</Button></div></form></Modal>}
    </div>
  );
}

function Prompts() {
  const toast = useToast();
  const { data, error, reload } = useLoad(() => get('/api/admin/prompts'));
  const [stage, setStage] = useState('brand_strategy'); const [text, setText] = useState(''); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false);
  const st = data?.stages.find((s: any) => s.key === stage);
  const active = st?.versions.find((v: any) => v.active);
  useEffect(() => { if (active) setText(active.content); }, [stage, active?.version, data]);
  if (!data) return error ? <ErrorBox error={error} /> : <Spinner />;
  const act = async (fn: () => Promise<any>, ok: string) => { setBusy(true); try { await fn(); toast(ok); reload(); } catch (e: any) { toast(e.message, 'bad'); } finally { setBusy(false); } };
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">هذه هي التعليمات التي تشغّل كل مرحلة. كل حفظ ينشئ نسخة جديدة وتُفعَّل فورًا، وكل تشغيل يسجّل رقم النسخة التي استُخدمت. شكل المخرجات (JSON) يُضاف تلقائيًا من الكود ولا يتأثر بتعديلك.</p>
      <div className="flex flex-wrap gap-2">{data.stages.map((s: any) => <button key={s.key} onClick={() => setStage(s.key)} className={cx('rounded-xl border px-4 py-2 text-sm font-bold', stage === s.key ? 'border-ink bg-ink text-white' : 'border-line bg-white')}>{s.label}</button>)}</div>
      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        <Card><div className="mb-2 flex items-center gap-2"><b>البرومبت الفعّال</b>{active && <Tag tone="ok">النسخة {active.version}</Tag>}</div>
          <Textarea dir="ltr" rows={20} value={text} onChange={(e) => setText(e.target.value)} className="ltr font-mono !text-xs" />
          <div className="mt-3 flex flex-wrap items-end gap-2"><div className="min-w-[200px] flex-1"><Input placeholder="ملاحظة عن التغيير (اختياري)" value={note} onChange={(e) => setNote(e.target.value)} /></div>
            <Button busy={busy} disabled={text.trim() === active?.content.trim()} onClick={() => act(async () => { await post(`/api/admin/prompts/${stage}`, { content: text, note }); setNote(''); }, 'تم حفظ نسخة جديدة وتفعيلها ✓')}>حفظ كنسخة جديدة</Button>
            <Button variant="ghost" onClick={() => confirm('إنشاء نسخة جديدة من البرومبت الافتراضي في الملف؟') && act(() => post(`/api/admin/prompts/${stage}/reset-default`), 'تمت الإعادة للافتراضي ✓')}>إعادة للافتراضي</Button></div></Card>
        <Card><b>النسخ</b><div className="mt-3 max-h-[480px] space-y-2 overflow-y-auto">{st.versions.map((v: any) => <div key={v.version} className={cx('rounded-xl border p-3 text-sm', v.active ? 'border-ok bg-ok-soft' : 'border-line')}>
          <div className="flex items-center justify-between"><b>النسخة {v.version}</b>{v.active ? <Tag tone="ok">فعّالة</Tag> : <Button variant="soft" disabled={busy} onClick={() => act(() => post(`/api/admin/prompts/${stage}/activate`, { version: v.version }), `تم تفعيل النسخة ${v.version} ✓`)}>تفعيل</Button>}</div>
          <div className="mt-1 text-xs text-muted">{new Date(v.created_at).toLocaleString('ar-EG')}{v.note && ` · ${v.note}`}</div>
          {!v.active && <button className="mt-1 text-xs underline" onClick={() => setText(v.content)}>عرض في المحرر</button>}</div>)}</div></Card>
      </div>
    </div>
  );
}

function Events() {
  const toast = useToast(); const { meta } = useAuth();
  const { data, error, reload } = useLoad(() => get('/api/admin/events'));
  const [open, setOpen] = useState(false); const empty = { market: 'all', name_ar: '', name_en: '', kind: 'fixed', month: 1, day: 1, hijri_month: 9, hijri_day: 1, note: '' }; const [f, setF] = useState<any>(empty); const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  if (!data) return error ? <ErrorBox error={error} /> : <Spinner />;
  const rows = data.events.filter((e: any) => !filter || e.market === filter);
  const when = (e: any) => e.kind === 'hijri' ? `هجري ${e.hijri_day}/${e.hijri_month}` : e.day ? `${e.day}/${e.month}` : `خلال شهر ${e.month}`;
  const market = (m: string) => m === 'all' ? 'كل الأسواق' : meta?.markets[m] || m;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><p className="max-w-2xl text-sm text-muted">هذه القاعدة هي مرجع الموديل للمواسم. كل صف جديد يبدأ «غير مؤكد» حتى تراجعه أنت. الموديل يُخبَر أي المناسبات غير مؤكدة فينبّه صانع المحتوى للتحقق منها.</p>
        <div className="flex gap-2"><Select value={filter} onChange={(e) => setFilter(e.target.value)} className="!w-auto"><option value="">كل الأسواق</option><option value="all">عام</option>{Object.entries(meta?.markets || {}).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select><Button onClick={() => { setF(empty); setOpen(true); }}>＋ مناسبة</Button></div></div>
      <Card className="overflow-x-auto !p-0"><table className="w-full min-w-[720px] text-sm"><thead className="bg-paper text-xs text-muted"><tr>{['المناسبة', 'السوق', 'التاريخ', 'ملاحظة', 'الحالة', ''].map((h) => <th key={h} className="px-4 py-3 text-start font-bold">{h}</th>)}</tr></thead>
        <tbody>{rows.map((e: any) => <tr key={e.id} className="border-t border-line align-top"><td className="px-4 py-3 font-bold">{e.name_ar}</td><td className="px-4 py-3">{market(e.market)}</td><td className="px-4 py-3">{when(e)}</td><td className="max-w-xs px-4 py-3 text-xs text-muted">{e.note}</td>
          <td className="px-4 py-3"><Tag tone={e.verified ? 'ok' : 'warn'}>{e.verified ? '✓ مؤكد' : 'غير مؤكد'}</Tag></td>
          <td className="px-4 py-3"><div className="flex gap-1"><Button variant="soft" onClick={async () => { await patch(`/api/admin/events/${e.id}`, { verified: !e.verified }); reload(); }}>{e.verified ? 'إلغاء التأكيد' : 'تأكيد'}</Button><Button variant="danger" onClick={async () => { if (confirm('حذف المناسبة؟')) { await del(`/api/admin/events/${e.id}`); reload(); } }}>حذف</Button></div></td></tr>)}</tbody></table></Card>
      {open && <Modal title="مناسبة جديدة" onClose={() => setOpen(false)}><form className="space-y-3" onSubmit={async (ev) => { ev.preventDefault(); setErr(null); try { const b: any = { market: f.market, name_ar: f.name_ar, name_en: f.name_en, kind: f.kind, note: f.note }; if (f.kind === 'hijri') { b.hijri_month = +f.hijri_month; b.hijri_day = +f.hijri_day; } else { b.month = +f.month; if (f.kind === 'fixed') b.day = +f.day; } await post('/api/admin/events', b); setOpen(false); toast('تمت الإضافة (غير مؤكدة) ✓'); reload(); } catch (x: any) { setErr(x.message); } }}>
        <Field label="اسم المناسبة"><Input required value={f.name_ar} onChange={(e) => setF({ ...f, name_ar: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3"><Field label="السوق"><Select value={f.market} onChange={(e) => setF({ ...f, market: e.target.value })}><option value="all">كل الأسواق</option>{Object.entries(meta?.markets || {}).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
          <Field label="النوع"><Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="fixed">تاريخ ميلادي ثابت</option><option value="hijri">تاريخ هجري</option><option value="note">موسم خلال الشهر</option></Select></Field></div>
        {f.kind === 'hijri' ? <div className="grid grid-cols-2 gap-3"><Field label="الشهر الهجري (1-12)"><Input type="number" min={1} max={12} value={f.hijri_month} onChange={(e) => setF({ ...f, hijri_month: e.target.value })} /></Field><Field label="اليوم"><Input type="number" min={1} max={30} value={f.hijri_day} onChange={(e) => setF({ ...f, hijri_day: e.target.value })} /></Field></div>
          : <div className="grid grid-cols-2 gap-3"><Field label="الشهر الميلادي"><Input type="number" min={1} max={12} value={f.month} onChange={(e) => setF({ ...f, month: e.target.value })} /></Field>{f.kind === 'fixed' && <Field label="اليوم"><Input type="number" min={1} max={31} value={f.day} onChange={(e) => setF({ ...f, day: e.target.value })} /></Field>}</div>}
        <Field label="ملاحظة ثقافية / تسويقية"><Textarea value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
        <ErrorBox error={err} /><div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setOpen(false)}>إلغاء</Button><Button type="submit">إضافة</Button></div></form></Modal>}
    </div>
  );
}

function Runs() {
  const { data, error, reload } = useLoad(() => get('/api/admin/runs?limit=100'));
  const [open, setOpen] = useState<any>(null);
  if (!data) return error ? <ErrorBox error={error} /> : <Spinner />;
  return (
    <div className="space-y-3"><div className="flex justify-between"><p className="text-sm text-muted">كل تشغيل يُسجَّل بالنسخة والموديل والمدخل والمخرج. الفاشل لا يُخصم منه كريديت ويبقى هنا للمراجعة.</p><Button variant="soft" onClick={reload}>تحديث</Button></div>
      <Card className="overflow-x-auto !p-0"><table className="w-full min-w-[760px] text-sm"><thead className="bg-paper text-xs text-muted"><tr>{['#', 'المرحلة', 'المستخدم', 'العميل', 'نسخة البرومبت', 'الموديل', 'الزمن', 'كريديت', 'الحالة', ''].map((h) => <th key={h} className="px-3 py-3 text-start font-bold">{h}</th>)}</tr></thead>
        <tbody>{data.runs.map((r: any) => <tr key={r.id} className="border-t border-line"><td className="px-3 py-2">{r.id}</td><td className="px-3 py-2">{r.stage}</td><td className="ltr px-3 py-2 text-xs">{r.email}</td><td className="px-3 py-2">{r.brand}</td><td className="px-3 py-2">v{r.prompt_version ?? '-'}</td><td className="ltr px-3 py-2 text-xs">{r.model}</td><td className="px-3 py-2">{r.latency_ms ? `${(r.latency_ms / 1000).toFixed(1)}ث` : '-'}</td><td className="px-3 py-2">{r.cost_credits}</td>
          <td className="px-3 py-2"><Tag tone={r.status === 'ok' ? 'ok' : 'bad'}>{r.status === 'ok' ? 'نجح' : 'فشل'}</Tag>{r.error && <div className="mt-1 max-w-[220px] text-xs text-bad">{r.error}</div>}</td><td className="px-3 py-2"><Button variant="ghost" onClick={async () => setOpen((await get(`/api/admin/runs/${r.id}`)).run)}>التفاصيل</Button></td></tr>)}</tbody></table></Card>
      {open && <Modal wide title={`تشغيل #${open.id} — ${open.stage}`} onClose={() => setOpen(null)}><div className="space-y-3"><div><b className="text-sm">المدخل</b><pre className="ltr mt-1 max-h-60 overflow-auto whitespace-pre-wrap rounded-xl bg-paper p-3 text-xs">{open.input}</pre></div><div><b className="text-sm">المخرج</b><pre className="ltr mt-1 max-h-60 overflow-auto whitespace-pre-wrap rounded-xl bg-paper p-3 text-xs">{open.output || '—'}</pre></div></div></Modal>}
    </div>
  );
}

function Settings() {
  const toast = useToast();
  const { data, error } = useLoad(() => get('/api/admin/settings'));
  const [costs, setCosts] = useState<Record<string, number> | null>(null);
  useEffect(() => { if (data) setCosts(data.costs); }, [data]);
  const labels: Record<string, string> = { brand_strategy: 'توليد استراتيجية', monthly_plan: 'خطة شهر (دفعة أفكار)', content_writer: 'كتابة محتوى لفكرة واحدة', form_from_voice: 'تحليل تسجيل صوتي' };
  if (!costs) return error ? <ErrorBox error={error} /> : <Spinner />;
  return (
    <Card className="max-w-xl"><h2 className="font-extrabold">تكلفة كل خطوة بالكريديت</h2><p className="mt-1 text-sm text-muted">تُخصم فقط عند نجاح التوليد. الأدمن لا يُخصم منه. احسب هذه الأرقام بعد معرفة تكلفة الموديل الفعلية قبل أي دفع حقيقي.</p>
      <div className="mt-4 space-y-3">{Object.keys(labels).map((k) => <Field key={k} label={labels[k]}><Input type="number" min={0} value={costs[k] ?? 0} onChange={(e) => setCosts({ ...costs, [k]: Number(e.target.value) })} className="!w-28" /></Field>)}</div>
      <Button className="mt-4" onClick={async () => { try { await put('/api/admin/settings/costs', costs); toast('تم الحفظ ✓'); } catch (e: any) { toast(e.message, 'bad'); } }}>حفظ</Button></Card>
  );
}
