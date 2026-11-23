export class ApiError extends Error { constructor(message: string, public status: number) { super(message); } }

export async function api<T = any>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { method, headers: body !== undefined ? { 'content-type': 'application/json' } : undefined, body: body !== undefined ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
  } catch { throw new ApiError('تعذّر الاتصال بالسيرفر. تأكد من الإنترنت وحاول مرة أخرى.', 0); }
  let data: any = null;
  try { data = await res.json(); } catch { /* empty */ }
  if (!res.ok) throw new ApiError(data?.error || `حدث خطأ (${res.status})`, res.status);
  return data as T;
}
export const get = <T = any>(u: string) => api<T>('GET', u);
export const post = <T = any>(u: string, b?: unknown) => api<T>('POST', u, b ?? {});
export const patch = <T = any>(u: string, b: unknown) => api<T>('PATCH', u, b);
export const put = <T = any>(u: string, b: unknown) => api<T>('PUT', u, b);
export const del = <T = any>(u: string) => api<T>('DELETE', u);

export interface User { id: number; email: string; name: string; role: 'admin' | 'creator'; credits: number }
export interface Meta {
  markets: Record<string, string>;
  formFields: { key: string; label: string; hint: string; long?: boolean }[];
  formats: { key: string; label: string }[];
  stages: { key: string; label: string }[];
  currentMonth: string;
}
