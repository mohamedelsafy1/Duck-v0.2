import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Link, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { get, post, type Meta, type User } from './api.ts';
import { Button, Spinner, ToastProvider } from './ui.tsx';
import { Login } from './pages/Login.tsx';
import { Brands } from './pages/Brands.tsx';
import { BrandPage } from './pages/BrandPage.tsx';
import { Admin } from './pages/Admin.tsx';
import { PublicForm } from './pages/PublicForm.tsx';
import { PublicCalendar } from './pages/PublicCalendar.tsx';

interface Ctx { user: User | null; meta: Meta | null; refresh: () => Promise<void>; setCredits: (n: number | null | undefined) => void }
const AuthCtx = createContext<Ctx>({ user: null, meta: null, refresh: async () => {}, setCredits: () => {} });
export const useAuth = () => useContext(AuthCtx);

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [ready, setReady] = useState(false);
  const refresh = useCallback(async () => {
    const [me, m] = await Promise.all([get('/api/auth/me'), get('/api/meta')]);
    setUser(me.user); setMeta(m); setReady(true);
  }, []);
  useEffect(() => { refresh().catch(() => setReady(true)); }, [refresh]);
  const setCredits = useCallback((n: number | null | undefined) => { if (typeof n === 'number') setUser((u) => (u ? { ...u, credits: n } : u)); }, []);

  if (!ready) return <div className="grid min-h-screen place-items-center text-muted"><Spinner /></div>;
  return (
    <ToastProvider>
      <AuthCtx.Provider value={{ user, meta, refresh, setCredits }}>
        <Routes>
          <Route path="/f/:token" element={<PublicForm />} />
          <Route path="/c/:token" element={<PublicCalendar />} />
          <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
          <Route path="/" element={<Guard><Shell><Home /></Shell></Guard>} />
          <Route path="/brands/:id" element={<Guard><Shell><BrandPage /></Shell></Guard>} />
          <Route path="/admin" element={<Guard admin><Shell><Admin /></Shell></Guard>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthCtx.Provider>
    </ToastProvider>
  );
}

const Home = () => { const { user } = useAuth(); return user?.role === 'admin' ? <Navigate to="/admin" replace /> : <Brands />; };

function Guard({ children, admin }: { children: React.ReactNode; admin?: boolean }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (admin && user.role !== 'admin') return <Navigate to="/" replace />;
  return <>{children}</>;
}

function Shell({ children }: { children: React.ReactNode }) {
  const { user, refresh } = useAuth();
  const nav = useNavigate();
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-line bg-paper/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <Link to="/" className="flex items-center gap-2 text-lg font-extrabold"><span aria-hidden>🐥</span> duckprompts</Link>
          <nav className="flex items-center gap-2 text-sm">
            {user?.role === 'admin' ? <Link className="rounded-lg px-3 py-1.5 font-bold hover:bg-black/5" to="/admin">لوحة الأدمن</Link>
              : <span className="rounded-full bg-duck/30 px-3 py-1 font-bold" title="رصيدك من الكريديت">⭐ {user?.credits} كريديت</span>}
            <span className="hidden text-muted sm:inline">{user?.name}</span>
            <Button variant="ghost" onClick={async () => { await post('/api/auth/logout'); await refresh(); nav('/login'); }}>خروج</Button>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
