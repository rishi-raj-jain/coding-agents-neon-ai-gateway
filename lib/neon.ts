// The Neon calls this example makes, through the official SDK (@neon/sdk).
// Reference: https://neon.com/docs/reference/typescript-sdk
//
// Every Agent37 instance gets its own Neon AI Gateway credential: a branch-scoped token
// with the ai_gateway:invoke scope. It reaches every model in the gateway's catalog and
// nothing else (no database, no storage), and it can be rotated or revoked on its own
// without touching any other instance.
import 'server-only';
import { createNeonClient } from '@neon/sdk';

// throwOnError turns every failed call into a thrown NeonError (with `kind`, `status`,
// and `message`), so the server's one error handler covers them.
const client = createNeonClient({
  apiKey: process.env.NEON_API_KEY!,
  // Only needed with a personal API key.
  orgId: process.env.NEON_ORG_ID || undefined,
  throwOnError: true,
});

const projectId = process.env.NEON_PROJECT_ID!;

// The branch the credentials are anchored to, and its gateway host. A credential works
// on its own branch and every branch created from it, so the default branch covers all
// of them. Looked up once.
let gatewayInfo: { branchId: string; baseUrl: string } | undefined;
export async function gateway() {
  if (!gatewayInfo) {
    const branchId = process.env.NEON_BRANCH_ID || (await client.branches.getDefault({ projectId })).id;
    const { enabled, base_url } = await client.aiGateway.get({ projectId, branchId });
    if (!enabled) throw new Error(`AI Gateway is not enabled on branch ${branchId}.`);
    gatewayInfo = { branchId, baseUrl: base_url };
  }
  return gatewayInfo;
}

// The api_token is shown once, here. It goes straight into the instance's env and is
// never stored by this server; only its token_id (not a secret) is kept, in metadata.
export async function createCredential(name: string) {
  const { branchId } = await gateway();
  const created = await client.credentials.create({
    projectId,
    branchId,
    name,
    scopes: ['ai_gateway:invoke'],
    principal_type: 'user',
  });
  return { tokenId: created.token_id, token: created.api_token };
}

// Rotation keeps the token_id and mints a new api_token. The old token stops working.
export async function rotateCredential(tokenId: string) {
  const { branchId } = await gateway();
  const rotated = await client.credentials.rotate({ projectId, branchId, tokenId });
  return { tokenId: rotated.token_id, token: rotated.api_token };
}

// Revocation takes effect on the gateway's next request: the instance's model calls
// fail with 401 from then on.
export async function revokeCredential(tokenId: string) {
  const { branchId } = await gateway();
  await client.credentials.revoke({ projectId, branchId, tokenId });
}

// Metadata for every credential on the branch (never the token itself), keyed by
// token_id: created_at, last_used_at, and revoked_at.
export async function listCredentials() {
  const { branchId } = await gateway();
  const list = await client.credentials.list({ projectId, branchId });
  return new Map(list.map((meta) => [meta.token_id, meta]));
}
