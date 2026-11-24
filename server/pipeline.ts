import { z } from 'zod';
import type { Db } from './db.ts';
import { config } from './config.ts';
import { AiError, getProvider } from './ai/provider.ts';
import { getActivePrompt, OUTPUT_CONTRACT, type Stage } from './prompts.ts';
import type { AuthUser } from './auth.ts';

export class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }

export const DEFAULT_COSTS: Record<string, number> = { brand_strategy: 3, monthly_plan: 5, content_writer: 1, form_from_voice: 1 };

export async function getCosts(db: Db): Promise<Record<string, number>> {
  const rows = await db.query<{ key: string; value: string }>(`SELECT key, value FROM settings WHERE key LIKE 'cost_%'`);
  const costs = { ...DEFAULT_COSTS };
  for (const r of rows) { const n = Number(r.value); if (Number.isFinite(n) && n >= 0) costs[r.key.slice(5)] = n; }
  return costs;
}

function extractJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(t); } catch { /* try to find object */ }
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
  throw new Error('no json');
}

export interface StageResult<T> { data: T; runId: number; cost: number; promptVersion: number; model: string; creditsLeft: number | null }

export async function runStage<T>(db: Db, opts: {
  user: AuthUser; brandId?: number | null; stage: Stage; userMessage: string; schema: z.ZodType<T, any, any>;
  audio?: { mimeType: string; dataBase64: string }; chargeMultiplier?: number;
}): Promise<StageResult<T>> {
  const { user, stage } = opts;
  const costs = await getCosts(db);
  const cost = user.role === 'admin' ? 0 : Math.round((costs[stage] ?? 1) * (opts.chargeMultiplier ?? 1));

  const fresh = await db.one<{ credits: number }>(`SELECT credits FROM users WHERE id=$1`, [user.id]);
  if (cost > 0 && (fresh?.credits ?? 0) < cost) throw new HttpError(402, `رصيدك ${fresh?.credits ?? 0} كريديت، وهذه الخطوة تحتاج ${cost}. اطلب شحنًا من الأدمن.`);

  const today = await db.one<{ c: number }>(`SELECT COUNT(*)::int AS c FROM runs WHERE user_id=$1 AND created_at > now() - interval '1 day'`, [user.id]);
  if (user.role !== 'admin' && (today?.c ?? 0) >= config.dailyRunCap) throw new HttpError(429, 'وصلت للحد اليومي لعدد العمليات في فترة التجربة. حاول غدًا.');

  let provider;
  try { provider = getProvider(); } catch (e: any) {
    await db.query(`INSERT INTO runs (user_id, brand_id, stage, model, input, status, error) VALUES ($1,$2,$3,'',$4,'error',$5)`, [user.id, opts.brandId ?? null, stage, opts.userMessage.slice(0, 20000), e.message]).catch(() => {});
    throw new HttpError(503, e.message);
  }
  const prompt = await getActivePrompt(db, stage);
  // Code-level language rule: models like gpt-oss otherwise drift into English because the prompt files are written in English.
  const LANGUAGE_RULE = stage === 'form_from_voice' ? '' : `\n\nLANGUAGE RULE (mandatory, overrides everything above): keep the JSON keys exactly as in the contract (English), but write EVERY string value in Arabic (Arabic script), including titles, summaries, ideas, captions and scripts. Use clear Modern Standard Arabic for strategy and analysis; for ideas and ready-to-publish content use the dialect requested in the brand profile (Egyptian market → simple Egyptian colloquial, Gulf → white Gulf dialect, otherwise Modern Standard Arabic). Write in English ONLY if the brand profile explicitly asks for English. Brand names, product names and hashtags may stay in their original script.`;
  const system = `${prompt.content}\n\n${OUTPUT_CONTRACT[stage]}${LANGUAGE_RULE}`;

  const started = Date.now();
  let raw = '';
  const logRun = async (status: 'ok' | 'error', error: string | null, charged: number) => {
    const r = await db.one<{ id: number }>(
      `INSERT INTO runs (user_id, brand_id, stage, prompt_version, model, input, output, status, error, latency_ms, cost_credits)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [user.id, opts.brandId ?? null, stage, prompt.version, provider.model, opts.userMessage.slice(0, 20000), raw.slice(0, 40000), status, error, Date.now() - started, charged]);
    return r!.id;
  };

  try {
    let res = await provider.generate({ stage, system, user: opts.userMessage, audio: opts.audio });
    raw = res.text;
    let parsed: T;
    try {
      parsed = opts.schema.parse(extractJson(raw));
    } catch (firstErr: any) {
      // one repair attempt: tell the model exactly what was wrong
      const why = firstErr instanceof z.ZodError ? firstErr.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') : 'not valid JSON';
      res = await provider.generate({ stage, system, user: `${opts.userMessage}\n\nYour previous answer was rejected (${why}). Return a corrected, complete JSON object that follows the output contract exactly.`, audio: opts.audio });
      raw = res.text;
      try { parsed = opts.schema.parse(extractJson(raw)); }
      catch (e2: any) {
        const why2 = e2 instanceof z.ZodError ? e2.issues.slice(0, 3).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ') : 'JSON غير صالح أو مقطوع';
        console.warn(`[ai] invalid output twice (${stage}): ${why2}; head=${raw.slice(0, 200).replace(/\s+/g, ' ')} tail=${raw.slice(-120).replace(/\s+/g, ' ')}`);
        throw new AiError(`الموديل رجّع نتيجة غير مكتملة مرتين (${why2}). لم يُخصم كريديت، حاول مرة أخرى.`, 'invalid_output');
      }
    }

    let creditsLeft: number | null = null;
    let charged = 0;
    if (cost > 0) {
      const upd = await db.one<{ credits: number }>(`UPDATE users SET credits=credits-$2 WHERE id=$1 AND credits>=$2 RETURNING credits`, [user.id, cost]);
      if (upd) { charged = cost; creditsLeft = upd.credits; }
    } else creditsLeft = fresh?.credits ?? null;
    const runId = await logRun('ok', null, charged);
    if (charged > 0) await db.query(`INSERT INTO credit_ledger (user_id, delta, reason, brand_id, run_id) VALUES ($1,$2,$3,$4,$5)`, [user.id, -charged, stage, opts.brandId ?? null, runId]);
    return { data: parsed, runId, cost: charged, promptVersion: prompt.version, model: res.model, creditsLeft };
  } catch (e: any) {
    const msg = e instanceof AiError || e instanceof HttpError ? e.message : `خطأ غير متوقع: ${String(e?.message || e).slice(0, 200)}`;
    await logRun('error', msg, 0).catch(() => {});
    if (e instanceof HttpError) throw e;
    const status = e instanceof AiError ? (e.code === 'rate_limited' ? 429 : e.code === 'not_configured' ? 503 : 502) : 500;
    throw new HttpError(status, msg);
  }
}
