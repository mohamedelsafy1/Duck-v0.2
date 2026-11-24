import { config } from '../config.ts';

export interface AiRequest {
  stage: string;
  system: string;
  user: string;
  audio?: { mimeType: string; dataBase64: string };
}
export interface AiResponse { text: string; model: string }
export interface AiProvider { name: string; model: string; generate(req: AiRequest): Promise<AiResponse> }

export class AiError extends Error {
  constructor(message: string, public code: 'not_configured' | 'rate_limited' | 'provider' | 'invalid_output' = 'provider') { super(message); }
}

// Simple concurrency limiter: the free API tier tolerates only a few parallel calls.
class Limiter {
  private active = 0;
  private queue: (() => void)[] = [];
  constructor(private max: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) await new Promise<void>((r) => this.queue.push(r));
    this.active++;
    try { return await fn(); } finally { this.active--; this.queue.shift()?.(); }
  }
}
const limiter = new Limiter(config.aiConcurrency);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function getProvider(): AiProvider {
  if (config.aiProvider === 'stub') {
    if (config.isProd) throw new AiError('وضع AI_PROVIDER=stub غير مسموح في الإنتاج.', 'not_configured');
    return stubProvider;
  }
  if (!config.geminiApiKey) {
    throw new AiError('مفتاح GEMINI_API_KEY غير مضبوط على السيرفر. اطلب من الأدمن إضافته في إعدادات الاستضافة.', 'not_configured');
  }
  return geminiProvider;
}

const geminiProvider: AiProvider = {
  name: 'gemini',
  model: config.geminiModel,
  async generate(req) {
    const { GoogleGenAI } = await import('@google/genai');
    const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });
    const parts: any[] = [{ text: req.user }];
    if (req.audio) parts.push({ inlineData: { mimeType: req.audio.mimeType, data: req.audio.dataBase64 } });
    let lastErr: any;
    let useThinking = (process.env.GEMINI_THINKING_LEVEL ?? 'low') !== 'off';
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await limiter.run(() => ai.models.generateContent({
          model: config.geminiModel,
          contents: [{ role: 'user', parts }],
          config: { systemInstruction: req.system, responseMimeType: 'application/json', temperature: 0.8, httpOptions: { timeout: Number(process.env.AI_TIMEOUT_MS) || 100_000 }, ...(useThinking ? { thinkingConfig: { thinkingLevel: (process.env.GEMINI_THINKING_LEVEL ?? 'low') as any } } : {}) },
        }));
        const text = res.text ?? '';
        if (!text.trim()) throw new AiError('رجع الموديل برد فاضي.', 'provider');
        return { text, model: config.geminiModel };
      } catch (e: any) {
        lastErr = e;
        const msg = String(e?.message || e);
        const status = e?.status ?? e?.code;
        if (useThinking && /thinking/i.test(msg)) { useThinking = false; attempt--; continue; }
        const retryable = status === 429 || status === 503 || /RESOURCE_EXHAUSTED|UNAVAILABLE|overloaded/i.test(msg);
        if (!retryable || attempt === 2) break;
        await sleep(2500 * (attempt + 1));
      }
    }
    const msg = String(lastErr?.message || lastErr);
    if (lastErr instanceof AiError) throw lastErr;
    if (/timeout|timed out|abort|DEADLINE/i.test(msg)) throw new AiError('الموديل اتأخر في الرد. جرّب تاني، ولم يُخصم أي كريديت.', 'provider');
    if (/429|RESOURCE_EXHAUSTED|quota/i.test(msg)) throw new AiError('وصلنا للحد المجاني لواجهة Gemini حاليًا. حاول بعد دقيقة، ولم يُخصم أي كريديت.', 'rate_limited');
    if (/API key|API_KEY|PERMISSION_DENIED|401|403/i.test(msg)) throw new AiError('مفتاح Gemini غير صالح أو غير مصرّح له. راجع الإعدادات.', 'not_configured');
    throw new AiError(`فشل الاتصال بالموديل: ${msg.slice(0, 200)}`, 'provider');
  },
};

// Local UI testing only. Output is clearly marked and the provider is refused in production.
const stubProvider: AiProvider = {
  name: 'stub',
  model: 'stub',
  async generate(req) {
    const T = '[تجريبي] ';
    switch (req.stage) {
      case 'brand_strategy':
        return { model: 'stub', text: JSON.stringify({
          summary: T + 'ملخص استراتيجية تجريبي.', goals: [T + 'زيادة الطلبات'], audience: [{ segment: T + 'شباب', insight: T + 'يحبون العروض' }],
          positioning: T + 'تموضع تجريبي', value_proposition: T + 'قيمة', differentiation: T + 'تمايز', personality: ['ودود'],
          tone: { description: T + 'نبرة قريبة', do: ['كن بسيطًا'], dont: ['لا تبالغ'], examples: [] },
          messaging_pillars: [T + 'رسالة 1'], content_pillars: [{ name: 'منتج', description: T + 'عرض المنتج' }, { name: 'مجتمع', description: T + 'قصص العملاء' }],
          channel_roles: [{ platform: 'Instagram', role: T + 'الواجهة' }], assumptions: [T + 'افتراض'], gaps: [T + 'ينقص معرفة الأسعار'], downstream_summary: T + 'ملخص للمراحل التالية' }) };
      case 'monthly_plan': {
        const n = Number(/COUNT:(\d+)/.exec(req.user)?.[1] || 24);
        const formats = ['carousel', 'static_post', 'reel_script', 'story', 'caption'];
        const batch = Number(/BATCH:(\d+)/.exec(req.user)?.[1] || 1);
        return { model: 'stub', text: JSON.stringify({ season_notes: T + 'ملاحظات الموسم', ideas: Array.from({ length: n }, (_, i) => ({
          title: `${T}فكرة ${batch}.${i + 1}`, concept: T + 'وصف الفكرة', pillar: i % 2 ? 'منتج' : 'مجتمع', suggested_format: formats[i % formats.length],
          cta: 'اطلب الآن', rationale: T + 'مرتبطة بالاستراتيجية', occasion: i % 5 === 0 ? 'مناسبة الشهر' : '' })) }) };
      }
      case 'content_writer': {
        const fmt = /FORMAT:(\w+)/.exec(req.user)?.[1] || 'static_post';
        const bodies: Record<string, any> = {
          static_post: { headline: T + 'عنوان', caption: T + 'نص المنشور', cta: 'اطلب الآن', visual_note: T + 'صورة المنتج' },
          carousel: { slides: [1, 2, 3].map((n) => ({ n, headline: `${T}شريحة ${n}`, body: T + 'نص', visual_note: '' })), caption: T + 'كابشن', cta: 'اطلب الآن' },
          reel_script: { hook: T + 'خطّاف', scenes: [1, 2].map((n) => ({ n, visual: T + 'مشهد', voiceover: T + 'تعليق', on_screen_text: '' })), cta: 'اطلب الآن', duration_sec: 20 },
          story: { frames: [1, 2].map((n) => ({ n, copy: T + 'إطار', interaction: '' })), cta: 'اسحب للأعلى' },
          caption: { caption: T + 'كابشن', cta: 'اطلب الآن' },
          ad: { primary_text: T + 'نص', headline: T + 'عنوان', description: T + 'وصف', cta: 'اطلب الآن' },
        };
        return { model: 'stub', text: JSON.stringify({ format: fmt, ...(bodies[fmt] || bodies.static_post) }) };
      }
      case 'form_from_voice':
        return { model: 'stub', text: JSON.stringify({ fields: { brand_name: T + 'براند', industry: 'مطاعم' }, missing: ['target_audience'], transcript_summary: T + 'ملخص' }) };
      default:
        throw new AiError('مرحلة غير معروفة.');
    }
  },
};
