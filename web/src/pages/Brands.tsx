import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { get, post } from '../api.ts';
import { Button, Card, Empty, ErrorBox, Field, Input, Modal, Select, Spinner, Tag } from '../ui.tsx';
import { useAuth } from '../App.tsx';

export function Brands() {
  const { meta } = useAuth();
  const nav = useNavigate();
  const [brands, setBrands] = useState<any[] | null>(null);
  const [usage, setUsage] = useState<any | null>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(''); const [market, setMarket] = useState('gulf');
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  useEffect(() => { get('/api/brands').then((r) => setBrands(r.brands)).catch((e) => setError(e.message)); get('/api/usage').then(setUsage).catch(() => {}); }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try { const r = await post('/api/brands', { name, market }); nav(`/brands/${r.brand.id}`); } catch (er: any) { setError(er.message); setBusy(false); }
  }
  const spent = (id: number) => usage?.perBrand?.find((p: any) => p.brand_id === id)?.spent;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-2xl font-extrabold">عملائي</h1><p className="text-sm text-muted">لكل عميل بروفايل مستقل، وفيه رابط فورم تبعته له أو تملؤه بنفسك.</p></div>
        <Button onClick={() => setOpen(true)}>＋ بروفايل عميل جديد</Button>
      </div>
      <ErrorBox error={error} />
      {!brands ? <div className="grid place-items-center py-16 text-muted"><Spinner /></div>
        : brands.length === 0 ? <Empty title="لسه مفيش عملاء" hint="أنشئ بروفايل أول عميل، وبعدها ابعت له رابط الفورم."><Button onClick={() => setOpen(true)}>إنشاء بروفايل</Button></Empty>
        : <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{brands.map((b) => (
          <Link key={b.id} to={`/brands/${b.id}`} className="block"><Card className="h-full transition hover:border-ink">
            <div className="flex items-start justify-between gap-2"><h2 className="font-extrabold">{b.name}</h2><Tag tone="duck">{meta?.markets[b.market] || b.market}</Tag></div>
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <Tag tone={b.form_status === 'submitted' ? 'ok' : b.form_status === 'draft' ? 'warn' : 'neutral'}>{b.form_status === 'submitted' ? 'الفورم مكتمل' : b.form_status === 'draft' ? 'الفورم ناقص' : 'الفورم فاضي'}</Tag>
              <Tag tone={b.strategy_status === 'approved' ? 'ok' : 'neutral'}>{b.strategy_status === 'approved' ? 'استراتيجية معتمدة' : b.strategy_status ? 'استراتيجية بانتظار الاعتماد' : 'بدون استراتيجية'}</Tag>
              <Tag>{b.plans} شهر</Tag>
            </div>
            {typeof spent(b.id) === 'number' && <div className="mt-3 text-xs text-muted">استهلك العميل ده {spent(b.id)} كريديت</div>}
          </Card></Link>))}</div>}
      {open && <Modal title="بروفايل عميل جديد" onClose={() => setOpen(false)}>
        <form onSubmit={create} className="space-y-4">
          <Field label="اسم العميل / البراند"><Input required autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="مثال: متجر السعادة" /></Field>
          <Field label="السوق" hint="يحدد اللهجة والمناسبات الموسمية في خطة الشهر"><Select value={market} onChange={(e) => setMarket(e.target.value)}>{Object.entries(meta?.markets || {}).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
          <ErrorBox error={error} />
          <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setOpen(false)}>إلغاء</Button><Button type="submit" busy={busy}>إنشاء</Button></div>
        </form></Modal>}
    </div>
  );
}
