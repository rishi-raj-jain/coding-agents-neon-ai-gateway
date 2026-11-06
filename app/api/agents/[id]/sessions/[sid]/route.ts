import { agent37, getAgent, instanceUrl, route } from '@/lib/agent37';
import type { AgentUIMessage } from '@/lib/chat-types';

type HistoryEntry = { role: string; content: string; thinking?: string };

// A stored session as UI messages, so useChat can pick the conversation up where it left
// off. The harness keeps the history; the page only needs the session id to continue.
export const GET = route(async (_request: Request, ctx: RouteContext<'/api/agents/[id]/sessions/[sid]'>) => {
  const { id, sid } = await ctx.params;
  const agent = await getAgent(id);
  const session = await agent37<{ history?: HistoryEntry[] }>(instanceUrl(agent.id, `/v1/sessions/${encodeURIComponent(sid)}`));
  const messages: AgentUIMessage[] = (session.history || [])
    .filter((m) => m.role === 'user' || m.role === 'assistant') // system entries are compaction markers
    .map((m, index) => ({
      id: `${sid}-${index}`,
      role: m.role as 'user' | 'assistant',
      metadata: { sessionId: sid },
      parts: [...(m.thinking ? [{ type: 'reasoning' as const, text: m.thinking }] : []), { type: 'text' as const, text: m.content }],
    }));
  return Response.json({ id: sid, messages });
});
