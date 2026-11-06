import type { UIMessage } from 'ai';

// What rides on each assistant message besides its parts: the Agent37 session it
// belongs to (the next turn continues it), and the turn's usage once it completes.
export type AgentMessageMetadata = {
  sessionId?: string;
  usage?: { input_tokens?: number; output_tokens?: number; cost_usd?: number | null } | null;
};

export type AgentUIMessage = UIMessage<AgentMessageMetadata>;
