// The Agent37 calls this example makes, over plain fetch.
// Reference: https://www.agent37.com/docs/llms-full.txt
import 'server-only';
import type { HarnessId } from './harnesses';

const API_KEY = process.env.AGENT37_API_KEY!;
const API_BASE = process.env.AGENT37_API_BASE || 'https://api.agent37.com';
const APP_DOMAIN = process.env.AGENT37_APP_DOMAIN || 'agent37.app';
const SANDBOX_BASE = `https://sandbox.${APP_DOMAIN}`;

// Tags this app's instances in metadata, so it can share a workspace with other apps.
export const APP_TAG = 'coding-agents-neon-ai-gateway';

const AUTH_HEADERS = { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' };
export const AGENT_HEADERS = { 'X-Agent37-Key': API_KEY, 'Content-Type': 'application/json' };

export const instanceUrl = (id: string, pathname: string) => `https://${id}.${APP_DOMAIN}${pathname}`;
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// This app's whole state: { app, harness, neon_token_id }.
export type AgentMetadata = { app: string; harness: HarnessId; neon_token_id: string };
export type Instance = { id: string; name: string; status: string; metadata: AgentMetadata; created_at?: string };

// Agent37 errors come as { error: { code, message } }, except a request turned away on
// sandbox.agent37.app before it reaches the instance, which carries a flat
// { error: "not_found" }.
export class UpstreamError extends Error {
  status: number;
  code: string;
  constructor(status: number, body: any) {
    const code = typeof body?.error === 'object' ? body.error.code : body?.error || 'upstream_error';
    super((typeof body?.error === 'object' && body.error.message) || String(code).replaceAll('_', ' '));
    this.status = status;
    this.code = code;
  }
}

// Sandbox API calls take the key as a Bearer token; instance URLs and exec take it raw
// in X-Agent37-Key.
export async function agent37<T = any>(url: string, init: RequestInit = {}): Promise<T> {
  const headers = url.startsWith(API_BASE) ? AUTH_HEADERS : AGENT_HEADERS;
  const res = await fetch(url, { ...init, headers: { ...headers, ...init.headers } });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new UpstreamError(res.status, body);
  return body;
}

export const sandbox = <T = any>(pathname: string, init?: RequestInit) => agent37<T>(`${API_BASE}/v1${pathname}`, init);
export const post = <T = any>(pathname: string, body?: unknown) => sandbox<T>(pathname, { method: 'POST', body: JSON.stringify(body ?? {}) });
export const patch = <T = any>(pathname: string, body: unknown) => sandbox<T>(pathname, { method: 'PATCH', body: JSON.stringify(body) });

// Run a shell command on the instance. A nonzero exit is a normal 200 from exec, so
// check it here.
export async function exec(id: string, command: string) {
  const result = await agent37<{ exit_code: number; stdout: string; stderr: string }>(`${SANDBOX_BASE}/v1/instances/${id}/exec`, {
    method: 'POST',
    body: JSON.stringify({ command }),
  });
  if (result.exit_code !== 0) {
    throw new UpstreamError(502, { error: { code: 'setup_failed', message: `Setup on ${id} exited ${result.exit_code}: ${result.stderr.slice(0, 500)}` } });
  }
  return result.stdout;
}

const isOurs = (instance: Instance) => instance.metadata?.app === APP_TAG && instance.status !== 'deleted';

export async function listAgents() {
  const { data } = await sandbox<{ data: Instance[] }>('/instances');
  return data.filter(isOurs);
}

// Every per-instance route checks this first, so the app never touches an instance
// another app created in the same workspace.
export async function getAgent(id: string) {
  if (!/^[a-z0-9]{10}$/.test(id)) throw new UpstreamError(400, { error: { code: 'invalid_request', message: 'Bad instance id.' } });
  const instance = await sandbox<Instance>(`/instances/${id}`);
  if (!isOurs(instance)) throw new UpstreamError(404, { error: { code: 'not_found', message: 'Not an agent of this app.' } });
  return instance;
}

// "running" means the container is up; the harness inside answers a little later. With
// ?agent=, health also reports whether that harness has a working login.
export async function isReady(id: string, harness: HarnessId) {
  try {
    const res = await fetch(instanceUrl(id, `/v1/health?agent=${harness}`), { headers: AGENT_HEADERS, signal: AbortSignal.timeout(8000) });
    const health = res.ok ? await res.json().catch(() => null) : null;
    return Boolean(health?.ok && health.healthy);
  } catch {
    return false;
  }
}

export async function waitForReady(id: string, harness: HarnessId, timeoutMs = 300_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isReady(id, harness)) return;
    await delay(3000);
  }
  throw new UpstreamError(504, { error: { code: 'timeout', message: `The agent on ${id} did not come up.` } });
}

// A container gets its env when it starts, so a new token reaches the harness only on a
// restart.
export async function restart(id: string, harness: HarnessId) {
  await post(`/instances/${id}/restart`);
  await waitForReady(id, harness);
}

// One error shape for every route: Agent37 errors carry their HTTP status; Neon SDK
// errors carry `status` when the API answered (and a `kind` such as "not_found").
export function errorResponse(err: any) {
  const status = Number.isInteger(err?.status) && err.status >= 400 ? err.status : 502;
  return Response.json({ error: { code: err?.code || err?.kind || 'upstream_unreachable', message: String(err?.message || err) } }, { status });
}

// Wraps a route handler so a thrown error becomes that JSON shape.
export function route<A extends unknown[]>(handler: (...args: A) => Promise<Response>) {
  return async (...args: A) => {
    try {
      return await handler(...args);
    } catch (err) {
      return errorResponse(err);
    }
  };
}
