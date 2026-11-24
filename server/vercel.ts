// Vercel serverless entry: boots the same Express app once per instance.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { openDb } from './db.ts';
import { seedAll } from './seed.ts';
import { createApp } from './app.ts';

let booting: Promise<ReturnType<typeof createApp>> | null = null;
const boot = async () => {
  const db = await openDb();
  await seedAll(db);
  return createApp(db);
};

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    booting ??= boot().catch((e) => { booting = null; throw e; });
    const app = await booting;
    (app as any)(req, res);
  } catch (e: any) {
    console.error('[boot]', e);
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'تعذّر تشغيل الخادم. راجع إعدادات DATABASE_URL.' }));
  }
}
