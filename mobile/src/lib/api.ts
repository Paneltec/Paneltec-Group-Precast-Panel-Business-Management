import AsyncStorage from '@react-native-async-storage/async-storage';

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL;
export const API_BASE = `${BACKEND_URL}/api`;
const TOKEN_KEY = 'paneltec_token';

export const tokenStore = {
  get: async (): Promise<string | null> => AsyncStorage.getItem(TOKEN_KEY),
  set: async (t: string) => AsyncStorage.setItem(TOKEN_KEY, t),
  clear: async () => AsyncStorage.removeItem(TOKEN_KEY),
};

type RequestOptions = {
  method?: string;
  headers?: Record<string, string>;
  body?: any;
  params?: Record<string, any>;
};

export async function api(path: string, options: RequestOptions = {}) {
  const { method = 'GET', headers = {}, body, params } = options;
  const token = await tokenStore.get();

  let url = `${API_BASE}${path}`;
  if (params) {
    const sp = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null) sp.append(k, String(v));
    });
    const qs = sp.toString();
    if (qs) url += `?${qs}`;
  }

  const reqHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...headers,
  };
  if (token) reqHeaders['Authorization'] = `Bearer ${token}`;

  const res = await fetch(url, {
    method,
    headers: reqHeaders,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    const err: any = new Error(formatApiErrorDetail(errData.detail));
    err.status = res.status;
    err.data = errData;
    throw err;
  }

  return res.json();
}

export function formatApiErrorDetail(detail: any): string {
  if (detail == null) return 'Something went wrong. Please try again.';
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail))
    return detail
      .map((e: any) => (e && typeof e.msg === 'string' ? e.msg : JSON.stringify(e)))
      .filter(Boolean)
      .join(' ');
  if (detail && typeof detail.msg === 'string') return detail.msg;
  if (detail && typeof detail.message === 'string') return detail.message;
  return String(detail);
}
