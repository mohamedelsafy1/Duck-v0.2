import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { Db } from './db.ts';

export const STAGES = ['brand_strategy', 'monthly_plan', 'content_writer', 'form_from_voice'] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABELS: Record<Stage, string> = {
  brand_strategy: 'استراتيجية البراند',
  monthly_plan: 'خطة الشهر والأفكار',
  content_writer: 'كتابة المحتوى',
  form_from_voice: 'الفورم من الصوت',
};

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'prompts', 'defaults');
export const readDefault = (stage: Stage) => fs.readFileSync(path.join(dir, `${stage}.md`), 'utf8').trim();

// The output contract is appended by code so that editing a prompt in the admin panel
// can change behaviour but cannot silently break the JSON shape the app depends on.
export const OUTPUT_CONTRACT: Record<Stage, string> = {
  brand_strategy: `OUTPUT CONTRACT — return ONLY one JSON object:
{"summary":string,"goals":string[],"audience":[{"segment":string,"insight":string}],"positioning":string,"value_proposition":string,"differentiation":string,"personality":string[],"tone":{"description":string,"do":string[],"dont":string[],"examples":string[]},"messaging_pillars":string[],"content_pillars":[{"name":string,"description":string}],"channel_roles":[{"platform":string,"role":string}],"assumptions":string[],"gaps":string[],"downstream_summary":string}`,
  monthly_plan: `OUTPUT CONTRACT — return ONLY one JSON object:
{"season_notes":string,"ideas":[{"title":string,"concept":string,"pillar":string,"suggested_format":"carousel"|"static_post"|"reel_script"|"story"|"caption"|"ad","cta":string,"rationale":string,"occasion":string}]}
Return exactly the requested number of ideas. "occasion" is empty when the idea is not tied to an occasion.`,
  content_writer: `OUTPUT CONTRACT — return ONLY one JSON object, with "format" equal to the requested format and these fields:
static_post: {"format","headline","caption","cta","visual_note","notes"}
carousel: {"format","slides":[{"n":number,"headline":string,"body":string,"visual_note":string}],"caption":string,"cta":string,"notes":string}
reel_script: {"format","hook":string,"scenes":[{"n":number,"visual":string,"voiceover":string,"on_screen_text":string}],"cta":string,"duration_sec":number,"notes":string}
story: {"format","frames":[{"n":number,"copy":string,"interaction":string}],"cta":string,"notes":string}
caption: {"format","caption":string,"cta":string,"notes":string}
ad: {"format","primary_text":string,"headline":string,"description":string,"cta":string,"notes":string}`,
  form_from_voice: `OUTPUT CONTRACT — return ONLY one JSON object:
{"fields":{"brand_name":string|null,"industry":string|null,"about":string|null,"products_services":string|null,"target_audience":string|null,"goals":string|null,"tone_voice":string|null,"offers_facts":string|null,"competitors":string|null,"constraints":string|null,"channels":string|null},"missing":string[],"transcript_summary":string}`,
};

export const strategySchema = z.object({
  summary: z.string().default(''),
  goals: z.array(z.string()).default([]),
  audience: z.array(z.object({ segment: z.string(), insight: z.string().default('') })).default([]),
  positioning: z.string().default(''),
  value_proposition: z.string().default(''),
  differentiation: z.string().default(''),
  personality: z.array(z.string()).default([]),
  tone: z.object({ description: z.string().default(''), do: z.array(z.string()).default([]), dont: z.array(z.string()).default([]), examples: z.array(z.string()).default([]) }).default({}),
  messaging_pillars: z.array(z.string()).default([]),
  content_pillars: z.array(z.object({ name: z.string(), description: z.string().default('') })).min(1),
  channel_roles: z.array(z.object({ platform: z.string(), role: z.string().default('') })).default([]),
  assumptions: z.array(z.string()).default([]),
  gaps: z.array(z.string()).default([]),
  downstream_summary: z.string().min(1),
});

export const FORMATS = ['carousel', 'static_post', 'reel_script', 'story', 'caption', 'ad'] as const;
export const FORMAT_LABELS: Record<string, string> = {
  carousel: 'كاروسيل', static_post: 'بوست ثابت', reel_script: 'سكريبت ريل/فيديو', story: 'ستوري', caption: 'كابشن', ad: 'إعلان',
};

export const planSchema = z.object({
  season_notes: z.string().default(''),
  ideas: z.array(z.object({
    title: z.string().min(1),
    concept: z.string().default(''),
    pillar: z.string().default(''),
    suggested_format: z.string().default('static_post'),
    cta: z.string().default(''),
    rationale: z.string().default(''),
    occasion: z.string().default(''),
  })).min(1),
});

export const contentSchema = z.object({ format: z.string() }).passthrough();

export const voiceSchema = z.object({
  fields: z.record(z.string().nullable()).default({}),
  missing: z.array(z.string()).default([]),
  transcript_summary: z.string().default(''),
});

export async function ensureDefaultPrompts(db: Db) {
  for (const stage of STAGES) {
    const row = await db.one(`SELECT 1 AS x FROM prompts WHERE stage=$1 LIMIT 1`, [stage]);
    if (!row) {
      await db.query(`INSERT INTO prompts (stage, version, content, note, active) VALUES ($1,1,$2,'النسخة الافتراضية من الملف',TRUE)`, [stage, readDefault(stage)]);
    }
  }
}

export async function getActivePrompt(db: Db, stage: Stage): Promise<{ version: number; content: string }> {
  const r = await db.one<{ version: number; content: string }>(`SELECT version, content FROM prompts WHERE stage=$1 AND active LIMIT 1`, [stage]);
  if (!r) throw new Error(`لا يوجد برومبت فعّال للمرحلة ${stage}`);
  return r;
}

export async function savePromptVersion(db: Db, stage: Stage, content: string, note: string, userId: number) {
  const max = await db.one<{ v: number }>(`SELECT COALESCE(MAX(version),0) AS v FROM prompts WHERE stage=$1`, [stage]);
  const version = (max?.v ?? 0) + 1;
  await db.query(`UPDATE prompts SET active=FALSE WHERE stage=$1`, [stage]);
  await db.query(`INSERT INTO prompts (stage, version, content, note, active, created_by) VALUES ($1,$2,$3,$4,TRUE,$5)`, [stage, version, content, note, userId]);
  return version;
}

export async function activatePromptVersion(db: Db, stage: Stage, version: number) {
  const ex = await db.one(`SELECT 1 AS x FROM prompts WHERE stage=$1 AND version=$2`, [stage, version]);
  if (!ex) return false;
  await db.query(`UPDATE prompts SET active=(version=$2) WHERE stage=$1`, [stage, version]);
  return true;
}
