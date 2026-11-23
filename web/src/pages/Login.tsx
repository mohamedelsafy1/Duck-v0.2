import React, { useState } from 'react';
import { post } from '../api.ts';
import { Button, Card, ErrorBox, Field, Input } from '../ui.tsx';
import { useAuth } from '../App.tsx';

export function Login() {
  const { refresh } = useAuth();
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try { await post('/api/auth/login', { email, password }); await refresh(); } catch (er: any) { setError(er.message); } finally { setBusy(false); }
  }
  return (
    <div className="grid min-h-screen place-items-center px-4">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center"><div className="text-5xl" aria-hidden>🐥</div><h1 className="mt-2 text-2xl font-extrabold">duckprompts</h1>
          <p className="mt-1 text-sm text-muted">من بيانات العميل إلى كالندر محتوى جاهز للموافقة</p></div>
        <Card>
          <form onSubmit={submit} className="space-y-4">
            <Field label="البريد الإلكتروني"><Input type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} className="ltr" /></Field>
            <Field label="كلمة المرور"><Input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className="ltr" /></Field>
            <ErrorBox error={error} />
            <Button type="submit" busy={busy} className="w-full">دخول</Button>
          </form>
        </Card>
        <p className="mt-4 text-center text-xs text-muted">نسخة تجريبية. اطلب حسابك من الأدمن.</p>
      </div>
    </div>
  );
}
