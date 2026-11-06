'use client';

// The home page: create a coding agent, and one card per agent with its Neon AI Gateway
// credential. Each card can rotate or revoke that agent's credential on its own.
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

type HarnessInfo = { id: string; label: string; dialect: string; models: { id: string; label: string }[] };
type Credential = { token_id_short: string; created_at: string; last_used_at: string | null; revoked_at: string | null };
type Agent = { id: string; name: string; metadata: { harness: string }; credential: Credential | null };

function timeAgo(iso: string | null) {
  if (!iso) return 'never';
  const s = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export function AgentsDashboard() {
  const [harnesses, setHarnesses] = useState<{ gateway: string; data: HarnessInfo[] } | null>(null);
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [status, setStatus] = useState('');

  const refresh = useCallback(async () => {
    try {
      setAgents((await api<{ data: Agent[] }>('/api/agents')).data);
    } catch (err) {
      setStatus(`Could not load agents: ${(err as Error).message}`);
    }
  }, []);

  useEffect(() => {
    api('/api/harnesses')
      .then(setHarnesses)
      .catch((err) => setStatus(`Could not reach Neon AI Gateway: ${err.message}`));
    refresh();
    // A credential's "last used" moves with every turn: keep the list fresh.
    const timer = setInterval(refresh, 15000);
    return () => clearInterval(timer);
  }, [refresh]);

  return (
    <div>
      <header className="flex items-center justify-between gap-3 border-b bg-background px-6 py-3.5">
        <div className="font-semibold">
          Coding agents on Neon AI Gateway <span className="font-normal text-muted-foreground">· Agent37 + Neon example</span>
        </div>
        {harnesses && <code className="text-xs text-muted-foreground">{harnesses.gateway}</code>}
      </header>
      <main className="mx-auto w-full max-w-5xl p-6">
        {harnesses && <CreateForm harnesses={harnesses.data} onCreated={refresh} setStatus={setStatus} />}
        <p className="min-h-6 py-2 text-sm text-muted-foreground">{status}</p>
        <div className="flex flex-col gap-4">
          {agents?.map((agent) => (
            <AgentCard key={agent.id} agent={agent} harnesses={harnesses?.data || []} onChange={refresh} setStatus={setStatus} />
          ))}
        </div>
        {agents?.length === 0 && (
          <div className="px-6 py-16 text-center text-muted-foreground">
            <h2 className="mb-2 text-xl font-semibold text-foreground">No coding agents yet</h2>
            <p className="mx-auto max-w-2xl">
              Create one above. It gets its own computer on Agent37 and its own Neon AI Gateway credential, which reaches Claude, GPT, Gemini, and
              open-weight models with no provider keys. Rotate or revoke that credential from its card, without touching any other agent.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}

function CreateForm({ harnesses, onCreated, setStatus }: { harnesses: HarnessInfo[]; onCreated: () => void; setStatus: (s: string) => void }) {
  const [harness, setHarness] = useState(harnesses[0].id);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const selected = harnesses.find((h) => h.id === harness)!;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setStatus(
      harness === 'claude-code'
        ? 'Minting a Neon AI Gateway credential and creating the instance...'
        : `Minting a Neon AI Gateway credential, creating the instance, and pointing ${selected.label} at the gateway. This takes about a minute.`
    );
    try {
      await api('/api/agents', { method: 'POST', body: { harness, name: name.trim() } });
      setName('');
      setStatus('');
    } catch (err) {
      const e = err as Error & { code?: string };
      setStatus(e.code === 'insufficient_balance' ? 'Your Agent37 wallet balance is too low. Top up at agent37.com/dashboard/cloud/billing.' : `Create failed: ${e.message}`);
    }
    setBusy(false);
    onCreated();
  }

  return (
    <Card>
      <CardContent>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            {harnesses.map((h) => (
              <button
                type="button"
                key={h.id}
                onClick={() => setHarness(h.id)}
                className={cn('rounded-lg border px-4 py-2.5 text-left transition-colors', h.id === harness ? 'border-foreground bg-muted' : 'hover:border-foreground/30')}
              >
                <div className="text-sm font-semibold">{h.label}</div>
                <div className="text-xs text-muted-foreground">{h.dialect}</div>
              </button>
            ))}
          </div>
          <div className="text-xs text-muted-foreground">Models: {selected.models.map((m) => m.id).join(', ')}</div>
          <div className="flex gap-2.5">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={`${selected.label} agent`} maxLength={40} />
            <Button type="submit" disabled={busy}>
              {busy ? 'Creating...' : `Create ${selected.label} agent`}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function AgentCard({ agent, harnesses, onChange, setStatus }: { agent: Agent; harnesses: HarnessInfo[]; onChange: () => void; setStatus: (s: string) => void }) {
  const harness = harnesses.find((h) => h.id === agent.metadata.harness);
  const cred = agent.credential;
  const revoked = Boolean(cred?.revoked_at);
  const [busy, setBusy] = useState(false);
  const ready = useReady(agent.id);

  async function act(path: string, method: string, working: string, confirmText?: string) {
    if (confirmText && !confirm(confirmText)) return;
    setBusy(true);
    setStatus(working);
    try {
      await api(path, { method });
      setStatus('');
    } catch (err) {
      setStatus(`Failed: ${(err as Error).message}`);
    }
    setBusy(false);
    onChange();
  }

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <CardTitle className="flex items-center gap-2 text-base">
            {agent.name}
            <Badge variant="outline">{harness?.label || agent.metadata.harness}</Badge>
            <Badge variant={ready ? 'secondary' : 'outline'} className={ready ? 'text-green-700' : 'text-amber-700'}>
              {ready ? 'Ready' : 'Starting'}
            </Badge>
          </CardTitle>
          <CardDescription className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            <span>
              Instance <code>{agent.id}</code>
            </span>
            {cred ? (
              <>
                <span>
                  Credential <code>{cred.token_id_short}</code>
                </span>
                <Badge variant={revoked ? 'destructive' : 'secondary'} className={revoked ? '' : 'text-green-700'}>
                  {revoked ? `Revoked ${timeAgo(cred.revoked_at)}` : 'Active'}
                </Badge>
                <span>Created {timeAgo(cred.created_at)}</span>
                <span>Last used {timeAgo(cred.last_used_at)}</span>
              </>
            ) : (
              <Badge variant="destructive">Credential not found</Badge>
            )}
          </CardDescription>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link href={`/agents/${agent.id}`}>Chat</Link>
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              act(
                `/api/agents/${agent.id}/rotate`,
                'POST',
                revoked ? 'Issuing a new credential and restarting the instance onto it...' : 'Rotating the credential and restarting the instance onto the new token...'
              )
            }
          >
            {revoked ? 'Issue new credential' : 'Rotate credential'}
          </Button>
          {!revoked && (
            <Button
              variant="outline"
              className="text-destructive"
              disabled={busy}
              onClick={() =>
                act(`/api/agents/${agent.id}/revoke`, 'POST', 'Revoking...', `Revoke ${agent.name}'s credential? Its model calls fail from now on. Every other agent keeps working.`)
              }
            >
              Revoke
            </Button>
          )}
          <Button
            variant="outline"
            className="text-destructive"
            disabled={busy}
            onClick={() => act(`/api/agents/${agent.id}`, 'DELETE', 'Deleting...', `Delete ${agent.name}? This deletes its instance and revokes its credential.`)}
          >
            Delete
          </Button>
        </div>
      </CardHeader>
    </Card>
  );
}

// "running" means the container is up; the harness inside answers a little later.
function useReady(id: string) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const ok = await api<{ ready: boolean }>(`/api/agents/${id}/ready`).then((r) => r.ready, () => false);
      if (stopped) return;
      setReady(ok);
      if (!ok) timer = setTimeout(tick, 5000);
    };
    tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [id]);
  return ready;
}
