import * as neon from '@/lib/neon';
import { getAgent, route } from '@/lib/agent37';

// Cut one agent off from every model, instantly. Its instance keeps running, and every
// other agent keeps working: each has a credential of its own.
export const POST = route(async (_request: Request, ctx: RouteContext<'/api/agents/[id]/revoke'>) => {
  const agent = await getAgent((await ctx.params).id);
  await neon.revokeCredential(agent.metadata.neon_token_id);
  return Response.json({ ok: true });
});
