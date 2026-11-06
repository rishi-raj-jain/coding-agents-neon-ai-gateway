import * as neon from '@/lib/neon';
import { HARNESSES, gatewayEnv } from '@/lib/harnesses';
import { exec, getAgent, patch, restart, route } from '@/lib/agent37';

// The instance restarts onto the new token and waits for its harness.
export const maxDuration = 300;

// Give the agent a new token. A live credential is rotated in place (same token_id, new
// token); a revoked one is replaced with a new credential. Either way the old token
// stops working, and the instance restarts onto the new one.
export const POST = route(async (_request: Request, ctx: RouteContext<'/api/agents/[id]/rotate'>) => {
  const agent = await getAgent((await ctx.params).id);
  const { harness, neon_token_id: tokenId } = agent.metadata;
  const meta = (await neon.listCredentials()).get(tokenId);
  const credential = meta && !meta.revoked_at ? await neon.rotateCredential(tokenId) : await neon.createCredential(`agent37: ${agent.name}`);

  const { baseUrl } = await neon.gateway();
  await patch(`/instances/${agent.id}`, {
    env: gatewayEnv(harness, credential.token, baseUrl),
    // metadata is replaced, not merged: send the whole object.
    metadata: { ...agent.metadata, neon_token_id: credential.tokenId },
  });
  const before = HARNESSES[harness].beforeRestart;
  if (before) await exec(agent.id, before);
  await restart(agent.id, harness);
  return Response.json({ ok: true, token_id: credential.tokenId });
});
