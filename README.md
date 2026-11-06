# coding-agents-neon-ai-gateway

Claude Code, Codex, and OpenCode on [Agent37](https://www.agent37.com/docs), with every model call going through [Neon AI Gateway](https://neon.com/docs/ai-gateway/overview). Each agent gets its own revocable Neon credential, which reaches Claude, GPT, Gemini, and open-weight models with no provider keys.

Next.js on the server, [AI SDK](https://ai-sdk.dev) `useChat` and [AI Elements](https://ai-sdk.dev/elements) in the browser.

## How it works

Creating an agent does three things:

1. Mints a Neon AI Gateway credential with the `ai_gateway:invoke` scope, named after the agent.
2. Creates an Agent37 instance with the token in its `env` and the credential's `token_id` in its `metadata`.
3. Points the instance's coding agent at the gateway in that agent's own dialect:

| Harness     | Template              | Gateway endpoint                                                 | How it's wired                                         |
| ----------- | --------------------- | ---------------------------------------------------------------- | ------------------------------------------------------ |
| Claude Code | `agent37-claude-code` | Anthropic Messages, `<base>/anthropic`                           | `ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN` in env |
| Codex       | `agent37-codex`       | OpenAI Responses, `<base>/openai/v1`                             | A `neon` model provider in `~/.codex/config.toml`      |
| OpenCode    | `agent37-opencode`    | Chat completions, `<base>/v1`, and Gemini, `<base>/gemini/v1beta` | Two providers in `~/.config/opencode/opencode.json`    |

All the per-harness wiring lives in [`lib/harnesses.ts`](./lib/harnesses.ts). The credential calls are in [`lib/neon.ts`](./lib/neon.ts).

From the agents page you can rotate an agent's token (the instance restarts onto the new one), revoke it (only that agent loses model access), or delete the agent (the instance goes and its credential is revoked). The server never stores a token: each one goes straight into an instance's write-only `env`.

The chat route ([`app/api/agents/[id]/chat/route.ts`](./app/api/agents/[id]/chat/route.ts)) translates the Agent37 gateway's event stream into an AI SDK UI message stream: text, reasoning, and one dynamic tool part per tool call.

## Run it

You need:

- An [Agent37 API key](https://www.agent37.com/dashboard/cloud/api-keys) and at least $10 in your [wallet](https://www.agent37.com/dashboard/cloud/billing).
- A [Neon](https://console.neon.tech) project in a region with AI Gateway (for example `aws-us-east-2`), with AI Gateway credits added on the **Billing** page.
- A [project-scoped Neon API key](https://neon.com/docs/manage/api-keys#create-project-scoped-organization-api-keys) for that project: in your organization's **Settings** > **API keys**, click **Create new** and select **Project-scoped**.

```bash
npm install
cp .env.example .env   # add both keys and your Neon project id
npm run dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000), pick a harness, and create an agent. A Claude Code agent is ready in about 30 seconds. Codex and OpenCode take about a minute, because the app writes their config and restarts the instance once.

The app has no login of its own, so `npm run dev` and `npm start` listen on `127.0.0.1` only. Put your own auth in front of it before you deploy it.

## What it costs

Two meters. Agent37 bills compute per minute from your wallet ($4.76 per month for the smallest instance). Neon bills every model call against the project's AI Gateway credits. Each instance's Agent37 managed-LLM budget stays at the default $0, so no model spend lands on Agent37.

## Good to know

- **Codex ignores `OPENAI_BASE_URL`.** The app adds a `neon` provider to `config.toml` with `requires_openai_auth = true`, because the Agent37 gateway checks for a Codex login before each turn, and `env_key = "NEON_AI_GATEWAY_TOKEN"`, so a rotation only changes env.
- **OpenCode's built-in `neon` provider sends the wrong variable as its key.** Its models.dev entry lists `NEON_AI_GATEWAY_BASE_URL` before `NEON_AI_GATEWAY_TOKEN`. The app sets `apiKey` to `{env:NEON_AI_GATEWAY_TOKEN}` explicitly.
- **Gemini goes through the native Gemini endpoint in OpenCode.** On chat completions, Gemini rejects the `$schema` keywords in OpenCode's tool definitions. The `neon-gemini` provider uses `@ai-sdk/google` with the token in an `Authorization` header.
- **Claude Code retries a revoked token for about three minutes** before it fails with "Not logged in". The chat route checks the credential first and refuses a turn on a revoked one right away.
- **Models describe themselves loosely.** Codex often reports a GPT-6 model whatever runs. The model actually sent is in `~/.codex/sessions` on the instance.

Full Agent37 API reference: [agent37.com/docs/llms-full.txt](https://www.agent37.com/docs/llms-full.txt). Neon AI Gateway: [neon.com/docs/ai-gateway](https://neon.com/docs/ai-gateway/overview).
