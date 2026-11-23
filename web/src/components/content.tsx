import React from 'react';
import { Textarea, Input, Tag } from '../ui.tsx';

export const KEY_LABELS: Record<string, string> = {
  headline: 'العنوان', caption: 'الكابشن', cta: 'الدعوة لاتخاذ إجراء', visual_note: 'ملاحظة بصرية', notes: 'ملاحظات للتنفيذ', slides: 'الشرائح', body: 'النص',
  hook: 'الخطّاف (أول ثانيتين)', scenes: 'المشاهد', visual: 'المشهد', voiceover: 'التعليق الصوتي', on_screen_text: 'النص على الشاشة', duration_sec: 'المدة بالثواني',
  frames: 'الإطارات', copy: 'النص', interaction: 'التفاعل', primary_text: 'النص الأساسي', description: 'الوصف',
};
const HIDDEN = new Set(['format', 'n']);

type Props = { value: any; onChange?: (v: any) => void; depth?: number };

export function BodyTree({ value, onChange, depth = 0 }: Props): React.ReactElement | null {
  if (Array.isArray(value)) {
    return <div className="space-y-3">{value.map((item, i) => (
      <div key={i} className="rounded-xl border border-line bg-paper/60 p-3">
        <div className="mb-2 text-xs font-bold text-muted">#{typeof item === 'object' && item?.n ? item.n : i + 1}</div>
        <BodyTree value={item} depth={depth + 1} onChange={onChange ? (v) => onChange(value.map((x: any, j: number) => (j === i ? v : x))) : undefined} />
      </div>))}</div>;
  }
  if (value && typeof value === 'object') {
    return <div className="space-y-3">{Object.entries(value).filter(([k, v]) => !HIDDEN.has(k) && v !== '' && v !== null && v !== undefined).map(([k, v]) => (
      <div key={k}>
        <div className="mb-1 text-xs font-bold text-muted">{KEY_LABELS[k] || k}</div>
        <BodyTree value={v} depth={depth + 1} onChange={onChange ? (nv) => onChange({ ...value, [k]: nv }) : undefined} />
      </div>))}</div>;
  }
  if (typeof value === 'number') return onChange ? <Input type="number" value={value} onChange={(e) => onChange(Number(e.target.value))} className="max-w-[120px]" /> : <span>{value}</span>;
  const s = String(value ?? '');
  if (onChange) return <Textarea value={s} rows={Math.min(8, Math.max(2, Math.ceil(s.length / 60)))} onChange={(e) => onChange(e.target.value)} />;
  return <p className="whitespace-pre-wrap text-sm leading-7">{s}</p>;
}

export const MARKS: Record<string, { label: string; icon: string; tone: 'ok' | 'bad' | 'warn'; chip: string }> = {
  approved: { label: 'موافق', icon: '✓', tone: 'ok', chip: 'bg-ok-soft text-ok border-ok/40' },
  rejected: { label: 'مرفوض', icon: '✕', tone: 'bad', chip: 'bg-bad-soft text-bad border-bad/40' },
  changes: { label: 'يحتاج تعديل', icon: '✎', tone: 'warn', chip: 'bg-warn-soft text-warn border-warn/40' },
};
export const MarkTag = ({ mark }: { mark?: string | null }) => {
  const m = mark ? MARKS[mark] : null;
  return m ? <Tag tone={m.tone}><span aria-hidden>{m.icon}</span> {m.label}</Tag> : <Tag>بانتظار المراجعة</Tag>;
};

export interface CalItem { id: number; schedule_date: string | null; title: string; format: string; review?: { mark: string } | null }

const DAYS = ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'];

export function CalendarGrid({ month, items, selectedId, onSelect, formatLabel }: { month: string; items: CalItem[]; selectedId?: number | null; onSelect: (id: number) => void; formatLabel: (k: string) => string }) {
  const [y, m] = month.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const offset = (first.getUTCDay() + 1) % 7; // week starts on Saturday
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: (number | null)[] = [...Array(offset).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  const byDay = new Map<number, CalItem[]>();
  for (const it of items) if (it.schedule_date?.startsWith(month)) { const d = Number(it.schedule_date.slice(8, 10)); byDay.set(d, [...(byDay.get(d) || []), it]); }
  return (
    <div className="overflow-x-auto">
      <div className="grid min-w-[640px] grid-cols-7 gap-px overflow-hidden rounded-2xl border border-line bg-line">
        {DAYS.map((d) => <div key={d} className="bg-paper px-2 py-2 text-center text-xs font-bold text-muted">{d}</div>)}
        {cells.map((d, i) => (
          <div key={i} className="min-h-[96px] bg-white p-1.5">
            {d && <div className="mb-1 text-xs font-bold text-muted">{d}</div>}
            <div className="space-y-1">{(d ? byDay.get(d) || [] : []).map((it) => {
              const mk = it.review ? MARKS[it.review.mark] : null;
              return <button key={it.id} onClick={() => onSelect(it.id)} aria-label={`${it.title} — ${mk ? mk.label : 'بانتظار المراجعة'}`}
                className={`block w-full truncate rounded-lg border px-1.5 py-1 text-start text-[11px] font-bold ${mk ? mk.chip : 'border-line bg-paper text-ink'} ${selectedId === it.id ? 'ring-2 ring-ink' : ''}`}>
                <span aria-hidden>{mk ? mk.icon : '•'}</span> {formatLabel(it.format)} · {it.title}</button>;
            })}</div>
          </div>))}
      </div>
    </div>
  );
}
