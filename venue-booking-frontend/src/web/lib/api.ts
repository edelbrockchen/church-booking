// src/web/lib/api.ts
// 統一 API 呼叫工具（含 :splat 防呆 + 舊版相容 apiFetch）

// ✅ 同網域預設（讓請求走前端網域的 /api/...，由靜態站代理到後端）
const DEFAULT_API_BASE = '';
// 若有設定 VITE_API_BASE_URL 就用它（僅限本地開發或特殊情境）
const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? DEFAULT_API_BASE).replace(/\/+$/, '');

export function apiUrl(path: string) {
  if (!path) path = '/';
  const clean = path.startsWith('/') ? path : `/${path}`;

  // 🛡 防呆：不應該出現 Rewrite 佔位符
  if (clean.includes(':splat')) {
    const err = new Error(`Invalid API path contains ":splat": ${clean}`);
    console.error(err);
    throw err;
  }
  return `${API_BASE}${clean}`;
}

/** 需要存取 Response（r.ok / r.status / headers）的情境用這個 */
export async function apiRaw(path: string, init?: RequestInit) {
  const res = await fetch(apiUrl(path), {
    credentials: 'include', // 一律帶上 session cookie
    headers: {
      'Accept': 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers || {}),
    },
    ...init,
  });
  return res;
}

/** 一般情境：直接回傳 JSON（非 2xx 會 throw） */
async function _json(path: string, init?: RequestInit) {
  const res = await apiRaw(path, init);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`[${res.status}] ${text || res.statusText}`);
  }
  return res.status === 204 ? null : res.json();
}

/** 舊版相容：仍可 import { apiFetch } 使用（回傳 JSON） */
export const apiFetch = _json;

/** 建議使用的新方法（語義更清楚） */
export const apiGet  = (p: string) => _json(p);
export const apiPost = (p: string, data?: unknown) =>
  _json(p, { method: 'POST', body: data ? JSON.stringify(data) : undefined });
export const apiPut  = (p: string, data?: unknown) =>
  _json(p, { method: 'PUT',  body: data ? JSON.stringify(data) : undefined });
export const apiDel  = (p: string) => _json(p, { method: 'DELETE' });