import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { get, post, type Meta } from '../api.ts';
import { Button, Card, ErrorBox, Spinner, Textarea, monthLabel, useToast, cx } from '../ui.tsx';
import { BodyTree, CalendarGrid, MARKS, MarkTag } from '../components/content.tsx';

export function PublicCalendar() {
  const { token } = useParams(); const toast = useToast();
  const [meta, setMeta] = useState<Meta | null>(null);
  const [data, setData] = useState<{ brand: string; month: string; items: any[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState<number | null>(null);
  const [comment, setComment] = useState(''); const [busy, setBusy] = useState(false);
  const load = () => get(`/api/public/calendar/${token}`).then(setData).catch((e) => setError(e.message));
  useEffect(() => { get('/api/meta').then(setMeta); load(); }, [token]);
  const fl = (k: string) => meta?.formats.find((f) => f.key === k)?.label || k;
  const item = useMemo(() => data?.items.find((i) => i.id === sel) || null, [data, sel]);
  useEffect(() => setComment(item?.review?.comment || ''), [sel]);
  const counts = useMemo(() => { const c: Record<string, number> = { approved: 0, rejected: 0, changes: 0, none: 0 }; data?.items.forEach((i) => { c[i.review?.mark || 'none']++; }); return c; }, [data]);

  async function mark(m: 'approved' | 'rejected' | 'changes') {
    if (!item) return;
    if (m !== 'approved' && !comment.trim()) return toast('اكتب سببًا أو ملاحظة قصيرة ليتمكن صانع المحتوى من التعديل.', 'bad');
    setBusy(true);
    try { await post(`/api/public/calendar/${token}/review`, { content_id: item.id, mark: m, comment }); await load(); toast('تم حفظ رأيك ✓'); } catch (e: any) { toast(e.message, 'bad'); } finally { setBusy(false); }
  }

  if (error) return <div className="grid min-h-screen place-items-center px-4"><Card className="max-w-md text-center"><div className="text-4xl">🔗</div><p className="mt-2 font-bold">{error}</p></Card></div>;
  if (!data || !meta) return <div className="grid min-h-screen place-items-center text-muted"><Spinner /></div>;
  const unscheduled = data.items.filter((i) => !i.schedule_date);
  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6 text-center"><div className="text-4xl" aria-hidden>🐥</div><h1 className="mt-1 text-2xl font-extrabold">{data.brand} — {monthLabel(data.month)}</h1>
        <p className="mt-1 text-sm text-muted">اضغط على أي منشور لقراءته، ثم اختر: موافق ✓ أو مرفوض ✕ أو يحتاج تعديل ✎.</p>
        <div className="mt-3 flex flex-wrap justify-center gap-2 text-xs font-bold">
          <span className="rounded-full bg-ok-soft px-3 py-1 text-ok">✓ موافق {counts.approved}</span><span className="rounded-full bg-warn-soft px-3 py-1 text-warn">✎ تعديل {counts.changes}</span>
          <span className="rounded-full bg-bad-soft px-3 py-1 text-bad">✕ مرفوض {counts.rejected}</span><span className="rounded-full bg-black/5 px-3 py-1 text-muted">بانتظار {counts.none}</span></div></div>
      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          <CalendarGrid month={data.month} items={data.items} selectedId={sel} onSelect={setSel} formatLabel={fl} />
          {unscheduled.length > 0 && <Card><div className="mb-2 text-sm font-bold">منشورات بدون تاريخ بعد</div><div className="flex flex-wrap gap-2">{unscheduled.map((i) => <button key={i.id} onClick={() => setSel(i.id)} className="rounded-lg border border-line bg-paper px-2 py-1 text-xs font-bold">{fl(i.format)} · {i.title}</button>)}</div></Card>}
        </div>
        <Card className="h-fit lg:sticky lg:top-4">
          {!item ? <p className="py-8 text-center text-sm text-muted">اختر منشورًا من الكالندر لعرضه.</p> : <div className="space-y-4">
            <div className="flex items-start justify-between gap-2"><div><div className="text-xs font-bold text-muted">{fl(item.format)} · {item.platform} {item.schedule_date && `· ${item.schedule_date}`}</div><h2 className="font-extrabold">{item.title}</h2></div><MarkTag mark={item.review?.mark} /></div>
            <div className="max-h-[40vh] overflow-y-auto rounded-xl bg-paper/70 p-3"><BodyTree value={item.body} /></div>
            <Textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="ملاحظتك (مطلوبة عند الرفض أو طلب التعديل)" />
            <div className="grid grid-cols-3 gap-2">{(['approved', 'changes', 'rejected'] as const).map((m) => (
              <button key={m} disabled={busy} onClick={() => mark(m)} className={cx('rounded-xl border-2 px-2 py-2 text-sm font-extrabold transition disabled:opacity-50', MARKS[m].chip, item.review?.mark === m && 'ring-2 ring-ink')}><span aria-hidden>{MARKS[m].icon}</span> {MARKS[m].label}</button>))}</div>
          </div>}
        </Card>
      </div>
    </div>
  );
}
