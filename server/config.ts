import 'node:process';

// Load .env manually (no dotenv dependency) for local development.
import fs from 'node:fs';
import path from 'node:path';
try {
  const envPath = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
} catch { /* ignore */ }

export const config = {
  isProd: process.env.NODE_ENV === 'production',
  isTest: process.env.NODE_ENV === 'test',
  port: Number(process.env.PORT) || 3000,
  databaseUrl: process.env.DATABASE_URL || '',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-3.8-flash,gemini-3-flash,gemini-2.5-flash-lite',
  // 'gemini' (default) or 'stub' (local UI testing only, refused in production)
  aiProvider: process.env.AI_PROVIDER || 'gemini',
  publicUrl: process.env.PUBLIC_URL || '',
  // Beta guard rails (free API tier has strict limits)
  aiConcurrency: Number(process.env.AI_CONCURRENCY) || 2,
  dailyRunCap: Number(process.env.DAILY_RUN_CAP_PER_USER) || 60,
  seedAdminEmail: process.env.ADMIN_EMAIL || 'admin@duck.test',
  seedAdminPassword: process.env.ADMIN_PASSWORD || '',
  seedDemo: process.env.SEED_DEMO !== 'false',
};
