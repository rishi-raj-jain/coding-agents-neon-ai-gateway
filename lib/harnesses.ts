// How each coding agent is pointed at Neon AI Gateway. Every harness gets the same two
// variables, NEON_AI_GATEWAY_TOKEN and NEON_AI_GATEWAY_BASE_URL, and then speaks to the
// gateway in its own dialect:
//
//   Claude Code  Anthropic Messages  <base>/anthropic      env only
//   Codex        OpenAI Responses    <base>/openai/v1      env + ~/.codex/config.toml
//   OpenCode     Chat completions    <base>/v1             env + ~/.config/opencode/opencode.json
//                and Gemini          <base>/gemini/v1beta
//
// `env` is what the instance boots with, and what a rotation rewrites. `setup` is a shell
// command the server runs once on the instance after create, for the harnesses that read
// their provider from a config file. `models` is what the chat page offers per turn.

export type HarnessId = 'claude-code' | 'codex' | 'opencode';

export type Harness = {
  label: string;
  template: string;
  dialect: string;
  env: (token: string, baseUrl: string) => Record<string, string>;
  setup: ((baseUrl: string) => string) | null;
  beforeRestart?: string;
  models: { id: string; label: string }[];
};

// Claude Code picks a model per role. Each role variable names a gateway model id, so a
// turn with "model": "opus" runs whatever ANTHROPIC_DEFAULT_OPUS_MODEL says.
const CLAUDE_ROLES = {
  sonnet: 'claude-sonnet-5-5',
  opus: 'claude-opus-5-5',
  haiku: 'claude-haiku-4-5',
  fable: 'claude-fable-5-1',
};

const claudeCode: Harness = {
  label: 'Claude Code',
  template: 'agent37-claude-code',
  dialect: 'Anthropic Messages',
  env: (token, baseUrl) => ({
    // Claude Code sends its normal Anthropic requests to this base URL, and the gateway's
    // Anthropic endpoint serves them. No Anthropic account or API key is involved.
    ANTHROPIC_BASE_URL: `${baseUrl}/anthropic`,
    ANTHROPIC_AUTH_TOKEN: token,
    ...Object.fromEntries(Object.entries(CLAUDE_ROLES).map(([role, id]) => [`ANTHROPIC_DEFAULT_${role.toUpperCase()}_MODEL`, id])),
  }),
  setup: null,
  models: Object.entries(CLAUDE_ROLES).map(([role, id]) => ({ id: role, label: `${role} (${id})` })),
};

// Codex no longer reads OPENAI_BASE_URL, so the gateway goes in as a model provider in
// config.toml. The image regenerates only its own keys there at boot and keeps these.
//
// requires_openai_auth makes Codex report its API-key login as the account, which the
// Agent37 gateway checks before every turn. env_key then sends the gateway token from
// the environment, so a rotation only has to change env.
const codexConfig = (baseUrl: string) => `model = "gpt-5-3-codex"
model_provider = "neon"

[model_providers.neon]
name = "Neon AI Gateway"
base_url = "${baseUrl}/openai/v1"
wire_api = "responses"
env_key = "NEON_AI_GATEWAY_TOKEN"
requires_openai_auth = true
`;

const codex: Harness = {
  label: 'Codex',
  template: 'agent37-codex',
  dialect: 'OpenAI Responses',
  // The image runs `codex login --with-api-key` with OPENAI_API_KEY at boot, which is
  // the login requires_openai_auth looks for.
  env: (token) => ({ OPENAI_API_KEY: token }),
  setup: (baseUrl) => `printf '%s' '${Buffer.from(codexConfig(baseUrl)).toString('base64')}' | base64 -d > ~/.codex/config.toml`,
  // The image logs in only when Codex is logged out, so drop the old login before a
  // restart that carries a new token.
  beforeRestart: 'codex logout >/dev/null 2>&1 || true',
  models: ['gpt-5-3-codex', 'gpt-6-1-sol', 'gpt-5-5', 'gpt-5-4-mini'].map((id) => ({ id, label: id })),
};

// OpenCode already knows Neon AI Gateway as a provider (`neon`, from models.dev), with
// the gateway's whole chat completions catalog. Two additions:
//   - provider.neon.options.apiKey names the token variable explicitly: the built-in
//     entry lists NEON_AI_GATEWAY_BASE_URL first, and OpenCode would send that as the key.
//   - neon-gemini reaches Gemini through the gateway's native Gemini endpoint. Gemini on
//     chat completions rejects the JSON Schema keywords in OpenCode's tool definitions.
//     The gateway takes a Bearer token, not the x-goog-api-key the SDK sends, so the
//     token goes in a header and apiKey is a placeholder the SDK insists on.
const OPENCODE_DEFAULT = 'neon/kimi-k3';
const opencodeConfig = `
  .provider.neon = { options: { apiKey: "{env:NEON_AI_GATEWAY_TOKEN}" } }
  | .provider["neon-gemini"] = {
      npm: "@ai-sdk/google",
      name: "Neon AI Gateway (Gemini)",
      options: {
        baseURL: "{env:NEON_AI_GATEWAY_BASE_URL}/gemini/v1beta",
        apiKey: "unused",
        headers: { Authorization: "Bearer {env:NEON_AI_GATEWAY_TOKEN}" }
      },
      models: { "gemini-3-1-pro": { name: "Gemini 3.1 Pro" }, "gemini-3-flash": { name: "Gemini 3 Flash" } }
    }
  | .model = "${OPENCODE_DEFAULT}"`;

const opencode: Harness = {
  label: 'OpenCode',
  template: 'agent37-opencode',
  dialect: 'Chat completions and Gemini',
  env: () => ({}),
  // The image merges its own managed provider into this file at boot and keeps every
  // other key, including a default model that is not one of its own.
  setup: () =>
    `cd ~/.config/opencode && f=opencode.json && { [ -s $f ] || echo '{}' > $f; } && ` +
    `jq '${opencodeConfig}' $f > $f.tmp && mv $f.tmp $f`,
  models: [
    OPENCODE_DEFAULT,
    'neon/glm-5-3',
    'neon/qwen35-122b-a10b',
    'neon/gpt-oss-120b',
    'neon/claude-sonnet-5-5',
    'neon/gpt-5-5',
    'neon-gemini/gemini-3-1-pro',
    'neon-gemini/gemini-3-flash',
  ].map((id) => ({ id, label: id })),
};

export const HARNESSES: Record<HarnessId, Harness> = { 'claude-code': claudeCode, codex, opencode };

export const isHarness = (id: unknown): id is HarnessId => typeof id === 'string' && id in HARNESSES;

// The variables every instance boots with, whichever harness it runs. A rotation calls
// this again with the new token and PATCHes the result.
export function gatewayEnv(harness: HarnessId, token: string, baseUrl: string) {
  return {
    NEON_AI_GATEWAY_TOKEN: token,
    NEON_AI_GATEWAY_BASE_URL: baseUrl,
    ...HARNESSES[harness].env(token, baseUrl),
  };
}
