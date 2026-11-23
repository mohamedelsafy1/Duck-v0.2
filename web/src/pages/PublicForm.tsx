import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { get, post, put, type Meta } from '../api.ts';
import { Button, Card, ErrorBox, Field, Input, Spinner, Tag, Textarea } from '../ui.tsx';
import { VoiceRecorder, type VoiceResult } from '../components/voice.tsx';

export function PublicForm() {
  const { token } = useParams();
  const [meta, setMeta] = useState<Meta | null>(null);
  const [info, setInfo] = useState<{ name: string; status: string } | null>(null);
  const [data, setData] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false); const [saved, setSaved] = useState<'submitted' | 'draft' | null>(null);
  const [summary, setSummary] = useState<VoiceResult | null>(null);
  useEffect(() => {
    Promise.all([get('/api/meta'), get(`/api/public/form/${token}`)]).then(([m, f]) => { setMeta(m); setInfo({ name: f.name, status: f.status }); setData(f.form_data || {}); }).catch((e) => setError(e.message));
  }, [token]);

  async function save() {
    setBusy(true); setError(null);
    try { const r = await put(`/api/public/form/${token}`, { form_data: data }); setSaved(r.status); window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }
  function applyVoice(r: VoiceResult) {
    setSummary(r);
    setData((d) => { const n = { ...d }; for (const [k, v] of Object.entries(r.fields)) if (v && !(n[k] || '').trim()) n[k] = v; return n; });
  }

  if (error && !info) return <div className="grid min-h-screen place-items-center px-4"><Card className="max-w-md text-center"><div className="text-4xl">🔗</div><p className="mt-2 font-bold">{error}</p></Card></div>;
  if (!info || !meta) return <div className="grid min-h-screen place-items-center text-muted"><Spinner /></div>;
  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <div className="mb-6 text-center"><div className="text-4xl" aria-hidden>🐥</div><h1 className="mt-1 text-2xl font-extrabold">بيانات {info.name}</h1>
        <p className="mt-1 text-sm text-muted">املأ ما تعرفه فقط. كل ما كتبته هنا هو أساس المحتوى، ولن نضيف أسعارًا أو عروضًا من عندنا.</p></div>
      {saved && <div role="status" className="mb-4 rounded-xl bg-ok-soft px-4 py-3 text-sm font-bold text-ok">{saved === 'submitted' ? '✓ تم الحفظ. شكرًا لك، صانع المحتوى سيكمل من هنا. يمكنك العودة وتعديل البيانات بنفس الرابط.' : 'تم حفظ ما كتبته، لكن الحقول الأساسية (الاسم، المجال، النبذة، الجمهور، الهدف) ما زالت ناقصة.'}</div>}
      <Card className="mb-4"><VoiceRecorder extract={(audio) => post(`/api/public/form/${token}/audio`, audio)} onResult={applyVoice} />
        {summary && <div className="mt-3 rounded-xl bg-duck/20 p-3 text-sm"><b>ما فهمناه من تسجيلك:</b> {summary.transcript_summary}<div className="mt-1 text-xs text-muted">راجع الحقول بالأسفل وصحّحها قبل الحفظ.{summary.missing.length ? ` لم تُذكر: ${summary.missing.map((k) => meta.formFields.find((f) => f.key === k)?.label || k).join('، ')}` : ''}</div></div>}</Card>
      <Card><div className="space-y-4">{meta.formFields.map((f) => (
        <Field key={f.key} label={f.label} hint={f.hint}>{f.long
          ? <Textarea value={data[f.key] || ''} onChange={(e) => setData({ ...data, [f.key]: e.target.value })} />
          : <Input value={data[f.key] || ''} onChange={(e) => setData({ ...data, [f.key]: e.target.value })} />}</Field>))}
        <ErrorBox error={error} /><Button onClick={save} busy={busy} className="w-full">حفظ البيانات</Button></div></Card>
      <p className="mt-4 text-center text-xs text-muted"><Tag>خاص</Tag> هذا الرابط يخصّك فقط. لا تشاركه مع غيرك.</p>
    </div>
  );
}
