// Calls this app's own /api routes from the browser. Errors come back as
// { error: { code, message } }. Every request is JSON, which the guard in proxy.ts
// requires of writes.
export async function api<T = any>(path: string, { method = 'GET', body }: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? (method === 'GET' ? undefined : '{}') : JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error(json?.error?.message || `HTTP ${res.status}`), { code: json?.error?.code });
  return json;
}
