import { agent37, getAgent, instanceUrl, route } from '@/lib/agent37';

type Session = { id: string; title?: string | null };

// The agent's sessions, newest first, for the chat sidebar. Claude Code titles its
// sessions; Codex and OpenCode often leave them untitled, so those fall back to the
// first thing the user said.
export const GET = route(async (_request: Request, ctx: RouteContext<'/api/agents/[id]/sessions'>) => {
  const agent = await getAgent((await ctx.params).id);
  const { data = [] } = await agent37<{ data?: Session[] }>(instanceUrl(agent.id, '/v1/sessions'));
  const titled = await Promise.all(
    data.slice(0, 30).map(async (session) => {
      if (session.title) return session;
      const { history = [] } = await agent37<{ history?: { role: string; content: string }[] }>(
        instanceUrl(agent.id, `/v1/sessions/${encodeURIComponent(session.id)}`)
      ).catch(() => ({ history: [] }));
      return { ...session, title: history.find((m) => m.role === 'user')?.content.slice(0, 60) || null };
    })
  );
  return Response.json({ data: titled });
});
