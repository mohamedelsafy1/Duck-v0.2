import { config } from './config.ts';

export interface Db {
  query<T = any>(sql: string, params?: any[]): Promise<T[]>;
  one<T = any>(sql: string, params?: any[]): Promise<T | null>;
  close(): Promise<void>;
  kind: 'pg' | 'pglite';
}

const MIGRATIONS: string[] = [
  `CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin','creator')),
    credits INTEGER NOT NULL DEFAULT 0,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL
  );
  CREATE TABLE brands (
    id SERIAL PRIMARY KEY,
    owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    market TEXT NOT NULL DEFAULT 'gulf',
    form_token TEXT UNIQUE NOT NULL,
    form_status TEXT NOT NULL DEFAULT 'empty' CHECK (form_status IN ('empty','draft','submitted')),
    form_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE strategies (
    id SERIAL PRIMARY KEY,
    brand_id INTEGER NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    content JSONB NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved')),
    feedback TEXT,
    run_id INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE plans (
    id SERIAL PRIMARY KEY,
    brand_id INTEGER NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
    month TEXT NOT NULL,
    strategy_id INTEGER REFERENCES strategies(id),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (brand_id, month)
  );
  CREATE TABLE ideas (
    id SERIAL PRIMARY KEY,
    plan_id INTEGER NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
    batch INTEGER NOT NULL DEFAULT 1,
    title TEXT NOT NULL,
    concept TEXT NOT NULL DEFAULT '',
    pillar TEXT NOT NULL DEFAULT '',
    suggested_format TEXT NOT NULL DEFAULT '',
    cta TEXT NOT NULL DEFAULT '',
    rationale TEXT NOT NULL DEFAULT '',
    occasion TEXT NOT NULL DEFAULT '',
    selected BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE contents (
    id SERIAL PRIMARY KEY,
    idea_id INTEGER NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
    plan_id INTEGER NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
    format TEXT NOT NULL,
    body JSONB NOT NULL,
    schedule_date DATE,
    platform TEXT NOT NULL DEFAULT '',
    run_id INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE calendars (
    id SERIAL PRIMARY KEY,
    plan_id INTEGER NOT NULL UNIQUE REFERENCES plans(id) ON DELETE CASCADE,
    share_token TEXT UNIQUE NOT NULL,
    published BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE reviews (
    id SERIAL PRIMARY KEY,
    content_id INTEGER NOT NULL REFERENCES contents(id) ON DELETE CASCADE,
    mark TEXT NOT NULL CHECK (mark IN ('approved','rejected','changes')),
    comment TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE prompts (
    id SERIAL PRIMARY KEY,
    stage TEXT NOT NULL,
    version INTEGER NOT NULL,
    content TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    active BOOLEAN NOT NULL DEFAULT FALSE,
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (stage, version)
  );
  CREATE TABLE events (
    id SERIAL PRIMARY KEY,
    market TEXT NOT NULL,
    name_ar TEXT NOT NULL,
    name_en TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL CHECK (kind IN ('fixed','hijri','note')),
    month INTEGER,
    day INTEGER,
    hijri_month INTEGER,
    hijri_day INTEGER,
    note TEXT NOT NULL DEFAULT '',
    verified BOOLEAN NOT NULL DEFAULT FALSE,
    verified_at TIMESTAMPTZ
  );
  CREATE TABLE credit_ledger (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    delta INTEGER NOT NULL,
    reason TEXT NOT NULL,
    brand_id INTEGER,
    run_id INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE runs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    brand_id INTEGER,
    stage TEXT NOT NULL,
    prompt_version INTEGER,
    model TEXT NOT NULL DEFAULT '',
    input TEXT NOT NULL DEFAULT '',
    output TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL CHECK (status IN ('ok','error')),
    error TEXT,
    latency_ms INTEGER,
    cost_credits INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE INDEX idx_runs_user_day ON runs (user_id, created_at);
  CREATE INDEX idx_brands_owner ON brands (owner_id);`,
];

export async function openDb(): Promise<Db> {
  let db: Db;
  if (config.databaseUrl) {
    const pg = await import('pg');
    const needsSsl = !/localhost|127\.0\.0\.1/.test(config.databaseUrl);
    pg.default.types.setTypeParser(1082, (v: string) => v); // keep DATE columns as 'YYYY-MM-DD' strings
    const pool = new pg.default.Pool({
      connectionString: config.databaseUrl,
      ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
      max: process.env.VERCEL ? 2 : 5,
    });
    db = {
      kind: 'pg',
      query: async (sql, params) => (await pool.query(sql, params)).rows,
      one: async (sql, params) => (await pool.query(sql, params)).rows[0] ?? null,
      close: () => pool.end(),
    };
  } else {
    if (config.isProd) {
      console.warn('[db] DATABASE_URL is not set in production: using a local PGlite file; data will be lost on redeploy on ephemeral hosts.');
    }
    const { PGlite } = await import('@electric-sql/pglite');
    const lite = config.isTest ? new PGlite({ parsers: { 1082: (v: string) => v } }) : new PGlite('./.pglite', { parsers: { 1082: (v: string) => v } });
    db = {
      kind: 'pglite',
      query: async (sql, params) => (await lite.query(sql, params)).rows as any[],
      one: async (sql, params) => ((await lite.query(sql, params)).rows[0] as any) ?? null,
      close: () => lite.close(),
    };
  }
  await migrate(db);
  return db;
}

async function migrate(db: Db) {
  await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY)`);
  const done = new Set((await db.query<{ version: number }>(`SELECT version FROM schema_migrations`)).map((r) => r.version));
  for (let i = 0; i < MIGRATIONS.length; i++) {
    if (done.has(i + 1)) continue;
    // PGlite/pg both accept multi-statement strings only without params via simple query for pg; split to be safe.
    for (const stmt of MIGRATIONS[i].split(/;\s*\n/).map((s) => s.trim()).filter(Boolean)) {
      await db.query(stmt);
    }
    await db.query(`INSERT INTO schema_migrations (version) VALUES ($1)`, [i + 1]);
  }
}
