import * as neon from '@/lib/neon';
import { HARNESSES, gatewayEnv, isHarness } from '@/lib/harnesses';
import { APP_TAG, exec, listAgents, post, restart, route, sandbox, waitForReady, type Instance } from '@/lib/agent37';

// Creating a Codex or OpenCode agent restarts its instance once: about a minute.
export const maxDuration = 300;

// Each agent with its credential's metadata from Neon: when it was created, when the
// gateway last saw it, and whether it is revoked. Never the token itself.
export const GET = route(async () => {
  const [agents, credentials] = await Promise.all([listAgents(), neon.listCredentials()]);
  return Response.json({
    data: agents.map((agent) => {
      const meta = credentials.get(agent.metadata.neon_token_id);
      return {
        ...agent,
        credential: meta
          ? { token_id_short: meta.token_id_short, created_at: meta.created_at, last_used_at: meta.last_used_at ?? null, revoked_at: meta.revoked_at ?? null }
          : null,
      };
    }),
  });
});

export const POST = route(async (request: Request) => {
  const { name: rawName, harness } = await request.json().catch(() => ({}));
  if (!isHarness(harness)) {
    return Response.json({ error: { code: 'invalid_request', message: `harness must be one of ${Object.keys(HARNESSES).join(', ')}.` } }, { status: 400 });
  }
  const h = HARNESSES[harness];
  const name = typeof rawName === 'string' && rawName.trim() ? rawName.trim().slice(0, 40) : `${h.label} agent`;

  // 1. A credential of this agent's own, named after it so it is easy to find in the
  //    Neon Console.
  const { baseUrl } = await neon.gateway();
  const credential = await neon.createCredential(`agent37: ${name}`);

  let instance: Instance | undefined;
  try {
    // 2. The instance boots with the token in its env. Its Agent37 managed budget stays
    //    at the default $0: every model call goes to the gateway, billed to the Neon
    //    project's AI Gateway credits.
    instance = await post<Instance>('/instances', {
      template: h.template,
      name,
      env: gatewayEnv(harness, credential.token, baseUrl),
      metadata: { app: APP_TAG, harness, neon_token_id: credential.tokenId },
    });

    // 3. Codex and OpenCode take their provider from a config file: write it, then
    //    restart so the harness starts on it.
    if (h.setup) {
      await waitForReady(instance.id, harness);
      await exec(instance.id, h.setup(baseUrl));
      await restart(instance.id, harness);
    }
    return Response.json(instance, { status: 201 });
  } catch (err) {
    if (instance?.id) await sandbox(`/instances/${instance.id}`, { method: 'DELETE' }).catch(() => {});
    await neon.revokeCredential(credential.tokenId).catch(() => {});
    throw err;
  }
});
