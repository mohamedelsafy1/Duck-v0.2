import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

export const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(' ');

export function Button({ variant = 'primary', busy, className, children, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' | 'soft'; busy?: boolean }) {
  const base = 'inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-bold transition disabled:opacity-50 disabled:cursor-not-allowed min-h-[40px]';
  const v = {
    primary: 'bg-duck text-ink hover:bg-duck-deep hover:text-white',
    soft: 'bg-white border border-line hover:border-ink',
    ghost: 'text-muted hover:text-ink hover:bg-black/5',
    danger: 'bg-bad-soft text-bad hover:bg-bad hover:text-white',
  }[variant];
  return <button {...p} disabled={p.disabled || busy} className={cx(base, v, className)}>{busy && <Spinner />}{children}</button>;
}

export const Spinner = () => <span aria-hidden className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />;

export const Card = ({ className, children }: { className?: string; children: React.ReactNode }) =>
  <div className={cx('rounded-2xl border border-line bg-white p-5 shadow-[0_1px_0_rgba(0,0,0,0.03)]', className)}>{children}</div>;

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-sm font-bold">{label}</span>{children}{hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}</label>;
}
const inputCls = 'w-full rounded-xl border border-line bg-white px-3 py-2 text-sm focus:border-ink';
export const Input = (p: React.InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={cx(inputCls, p.className)} />;
export const Textarea = (p: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea rows={3} {...p} className={cx(inputCls, 'leading-7', p.className)} />;
export const Select = (p: React.SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={cx(inputCls, p.className)} />;

export const Tag = ({ tone = 'neutral', children }: { tone?: 'neutral' | 'ok' | 'bad' | 'warn' | 'duck'; children: React.ReactNode }) => {
  const t = { neutral: 'bg-black/5 text-muted', ok: 'bg-ok-soft text-ok', bad: 'bg-bad-soft text-bad', warn: 'bg-warn-soft text-warn', duck: 'bg-duck/25 text-ink' }[tone];
  return <span className={cx('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold', t)}>{children}</span>;
};

export const ErrorBox = ({ error }: { error?: string | null }) => error ? <div role="alert" className="rounded-xl border border-bad/30 bg-bad-soft px-4 py-3 text-sm text-bad">{error}</div> : null;

export const Empty = ({ title, hint, children }: { title: string; hint?: string; children?: React.ReactNode }) => (
  <div className="rounded-2xl border border-dashed border-line px-6 py-10 text-center">
    <div className="text-3xl" aria-hidden>🐥</div>
    <div className="mt-2 font-bold">{title}</div>{hint && <div className="mt-1 text-sm text-muted">{hint}</div>}
    {children && <div className="mt-4 flex justify-center">{children}</div>}
  </div>
);

// ---- toast ----
const ToastCtx = createContext<(msg: string, tone?: 'ok' | 'bad') => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [t, setT] = useState<{ msg: string; tone: 'ok' | 'bad' } | null>(null);
  const show = useCallback((msg: string, tone: 'ok' | 'bad' = 'ok') => setT({ msg, tone }), []);
  useEffect(() => { if (!t) return; const id = setTimeout(() => setT(null), 3500); return () => clearTimeout(id); }, [t]);
  return <ToastCtx.Provider value={show}>{children}
    {t && <div role="status" className={cx('fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-xl px-5 py-3 text-sm font-bold shadow-lg', t.tone === 'ok' ? 'bg-ink text-white' : 'bg-bad text-white')}>{t.msg}</div>}
  </ToastCtx.Provider>;
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => { const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, [onClose]);
  return <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/40 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
    <div role="dialog" aria-modal="true" aria-label={title} className={cx('my-8 w-full rounded-2xl bg-white p-6', wide ? 'max-w-3xl' : 'max-w-lg')}>
      <div className="mb-4 flex items-center justify-between"><h2 className="text-lg font-extrabold">{title}</h2><button onClick={onClose} aria-label="إغلاق" className="rounded-lg px-2 py-1 text-xl text-muted hover:bg-black/5">×</button></div>
      {children}
    </div>
  </div>;
}

export function copyText(t: string) { return navigator.clipboard?.writeText(t); }
export const monthLabel = (m: string) => { const [y, mo] = m.split('-').map(Number); return new Intl.DateTimeFormat('ar', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, mo - 1, 1))); };
