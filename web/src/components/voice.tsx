import React, { useEffect, useRef, useState } from 'react';
import { Button, ErrorBox, Spinner } from '../ui.tsx';

const MAX_SECONDS = 180;

async function blobToWavBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const ctx = new AudioContext();
  const decoded = await ctx.decodeAudioData(buf.slice(0));
  await ctx.close();
  const off = new OfflineAudioContext(1, Math.max(1, Math.ceil(decoded.duration * 16000)), 16000);
  const src = off.createBufferSource(); src.buffer = decoded; src.connect(off.destination); src.start();
  const pcm = (await off.startRendering()).getChannelData(0);
  const out = new DataView(new ArrayBuffer(44 + pcm.length * 2));
  const w = (o: number, s: string) => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); out.setUint32(4, 36 + pcm.length * 2, true); w(8, 'WAVE'); w(12, 'fmt '); out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true);
  out.setUint32(24, 16000, true); out.setUint32(28, 32000, true); out.setUint16(32, 2, true); out.setUint16(34, 16, true); w(36, 'data'); out.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) out.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i])) * 0x7fff, true);
  const bytes = new Uint8Array(out.buffer); let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export interface VoiceResult { fields: Record<string, string | null>; missing: string[]; transcript_summary: string }

export function VoiceRecorder({ extract, onResult }: { extract: (audio: { mimeType: string; dataBase64: string }) => Promise<VoiceResult>; onResult: (r: VoiceResult) => void }) {
  const [state, setState] = useState<'idle' | 'recording' | 'working'>('idle');
  const [secs, setSecs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<number | undefined>(undefined);
  const stream = useRef<MediaStream | null>(null);

  useEffect(() => () => { clearInterval(timer.current); stream.current?.getTracks().forEach((t) => t.stop()); }, []);

  async function start() {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') return setError('المتصفح لا يدعم التسجيل الصوتي. استخدم Chrome أو Safari حديث، أو املأ الفورم كتابةً.');
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch { return setError('لم نحصل على إذن الميكروفون. اسمح به من إعدادات المتصفح ثم أعد المحاولة.'); }
    chunks.current = [];
    const mr = new MediaRecorder(stream.current); rec.current = mr;
    mr.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
    mr.onstop = async () => {
      stream.current?.getTracks().forEach((t) => t.stop()); clearInterval(timer.current); setState('working');
      try {
        const b64 = await blobToWavBase64(new Blob(chunks.current, { type: mr.mimeType }));
        onResult(await extract({ mimeType: 'audio/wav', dataBase64: b64 }));
      } catch (e: any) { setError(e?.message?.includes('decode') ? 'تعذّر قراءة التسجيل. حاول مرة أخرى.' : e?.message || 'فشل تحليل التسجيل.'); }
      setState('idle');
    };
    mr.start(); setSecs(0); setState('recording');
    timer.current = window.setInterval(() => setSecs((s) => { if (s + 1 >= MAX_SECONDS) mr.state === 'recording' && mr.stop(); return s + 1; }), 1000);
  }
  const mmss = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        {state === 'idle' && <Button variant="soft" onClick={start}>🎙️ سجّل رسالة صوتية بدل الكتابة</Button>}
        {state === 'recording' && <><Button variant="danger" onClick={() => rec.current?.stop()}>⏹ إنهاء التسجيل</Button><span className="font-bold text-bad" aria-live="polite">● {mmss}</span></>}
        {state === 'working' && <span className="flex items-center gap-2 text-sm text-muted"><Spinner /> جارٍ تحليل التسجيل وتعبئة الفورم…</span>}
      </div>
      <p className="text-xs text-muted">تكلّم عن النشاط والمنتجات والجمهور والهدف ونبرة البراند (حتى 3 دقائق). ستراجع الإجابات قبل حفظها.</p>
      <ErrorBox error={error} />
    </div>
  );
}
