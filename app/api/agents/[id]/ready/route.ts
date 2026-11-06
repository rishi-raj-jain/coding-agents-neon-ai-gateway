import { getAgent, isReady, route } from '@/lib/agent37';

export const GET = route(async (_request: Request, ctx: RouteContext<'/api/agents/[id]/ready'>) => {
  const agent = await getAgent((await ctx.params).id);
  return Response.json({ ready: await isReady(agent.id, agent.metadata.harness) });
});
