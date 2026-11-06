import * as neon from '@/lib/neon';
import { HARNESSES } from '@/lib/harnesses';
import { route } from '@/lib/agent37';

// The harnesses and their models, for the create form, plus the gateway host the
// credentials reach.
export const GET = route(async () => {
  const { baseUrl } = await neon.gateway();
  return Response.json({
    gateway: new URL(baseUrl).host,
    data: Object.entries(HARNESSES).map(([id, h]) => ({ id, label: h.label, dialect: h.dialect, models: h.models })),
  });
});
