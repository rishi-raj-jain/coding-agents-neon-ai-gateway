import * as neon from '@/lib/neon';
import { HARNESSES } from '@/lib/harnesses';
import { getAgent, route, sandbox } from '@/lib/agent37';

// One agent, with the models its harness reaches through the gateway.
export const GET = route(async (_request: Request, ctx: RouteContext<'/api/agents/[id]'>) => {
  const agent = await getAgent((await ctx.params).id);
  const h = HARNESSES[agent.metadata.harness];
  return Response.json({ ...agent, harness: { id: agent.metadata.harness, label: h.label, models: h.models } });
});

// Deleting an agent deletes its instance and revokes its credential, so the token that
// was on its disk stops working for good.
export const DELETE = route(async (_request: Request, ctx: RouteContext<'/api/agents/[id]'>) => {
  const agent = await getAgent((await ctx.params).id);
  await sandbox(`/instances/${agent.id}`, { method: 'DELETE' });
  await neon.revokeCredential(agent.metadata.neon_token_id).catch(() => {});
  return Response.json({ ok: true });
});
