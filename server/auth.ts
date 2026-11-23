import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import type { Db } from './db.ts';

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, keyHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !keyHex) return false;
  const key = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), 64);
  const expected = Buffer.from(keyHex, 'hex');
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}

export const newToken = (bytes = 24) => crypto.randomBytes(bytes).toString('base64url');
const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

export interface AuthUser { id: number; email: string; name: string; role: 'admin' | 'creator'; credits: number }

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express { interface Request { user?: AuthUser } }
}

const COOKIE = 'duck_session';
const DAYS = 14;

export async function createSession(db: Db, res: Response, userId: number, secure: boolean) {
  const token = newToken(32);
  await db.query(`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1,$2, now() + interval '${DAYS} days')`, [sha(token), userId]);
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure, maxAge: DAYS * 86400_000, path: '/' });
}

export async function destroySession(db: Db, req: Request, res: Response) {
  const token = readCookie(req, COOKIE);
  if (token) await db.query(`DELETE FROM sessions WHERE token_hash=$1`, [sha(token)]);
  res.clearCookie(COOKIE, { path: '/' });
}

function readCookie(req: Request, name: string): string | null {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

export function authMiddleware(db: Db) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const token = readCookie(req, COOKIE);
      if (token) {
        const u = await db.one<AuthUser>(
          `SELECT u.id,u.email,u.name,u.role,u.credits FROM sessions s JOIN users u ON u.id=s.user_id
           WHERE s.token_hash=$1 AND s.expires_at > now() AND u.active`, [sha(token)]);
        if (u) req.user = u;
      }
      next();
    } catch (e) { next(e); }
  };
}

export const requireUser = (req: Request, res: Response, next: NextFunction) =>
  req.user ? next() : void res.status(401).json({ error: 'يجب تسجيل الدخول أولًا.' });

export const requireAdmin = (req: Request, res: Response, next: NextFunction) =>
  req.user?.role === 'admin' ? next() : void res.status(403).json({ error: 'هذه الصفحة للأدمن فقط.' });

// Tiny in-memory login throttle (per ip+email) to blunt brute force.
const attempts = new Map<string, { n: number; t: number }>();
export function loginThrottled(key: string): boolean {
  const now = Date.now();
  const a = attempts.get(key);
  if (!a || now - a.t > 15 * 60_000) { attempts.set(key, { n: 1, t: now }); return false; }
  a.n++;
  return a.n > 8;
}
export const clearThrottle = (key: string) => attempts.delete(key);
