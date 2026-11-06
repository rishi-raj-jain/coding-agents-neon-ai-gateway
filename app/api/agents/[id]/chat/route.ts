import { createUIMessageStream, createUIMessageStreamResponse } from 'ai';
import * as neon from '@/lib/neon';
import { AGENT_HEADERS, UpstreamError, agent37, getAgent, instanceUrl, route } from '@/lib/agent37';
import type { AgentUIMessage } from '@/lib/chat-types';

// A coding turn can run for minutes. 300 seconds is the most a Vercel Hobby function
// gets; if the stream is cut off, the turn still finishes on the instance and its reply
// is in the session's history.
export const maxDuration = 300;

// The Agent37 gateway streams a turn as Server-Sent Events: blocks separated by a blank
// line, each with "event:" and "data:" lines. Lines starting with ":" are keepalives.
async function* sseEvents(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    let index;
    while ((index = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      if (!frame.trim() || frame.startsWith(':')) continue;
      const event = frame.match(/^event: (.+)$/m)?.[1];
      const data = frame.match(/^data: (.+)$/m)?.[1];
      if (event && data) yield { event, data: JSON.parse(data) };
    }
  }
}

// One turn: send the user's text to the agent's gateway, and translate its events into
// the AI SDK's UI message stream, which useChat on the page renders as it arrives.
//
//   response.created            -> start (with the session id as message metadata)
//   response.reasoning.delta    -> reasoning-start / reasoning-delta
//   response.output_text.delta  -> text-start / text-delta
//   response.tool_call.*        -> a dynamic tool part: input, then output or error
//   response.completed          -> finish (with usage)
//   response.failed             -> error
export const POST = route(async (request: Request, ctx: RouteContext<'/api/agents/[id]/chat'>) => {
  const agent = await getAgent((await ctx.params).id);
  const { text, model, sessionId } = await request.json();
  if (typeof text !== 'string' || !text.trim()) {
    return Response.json({ error: { code: 'invalid_request', message: 'Send JSON { "text" }.' } }, { status: 400 });
  }

  // The gateway refuses a revoked token on its own, but Claude Code retries a 401 for
  // minutes before it gives up. Say so at once instead.
  if ((await neon.listCredentials()).get(agent.metadata.neon_token_id)?.revoked_at) {
    return Response.json(
      { error: { code: 'credential_revoked', message: "This agent's Neon AI Gateway credential is revoked. Issue a new one from the agents page." } },
      { status: 403 }
    );
  }

  const upstream = await fetch(instanceUrl(agent.id, '/v1/responses'), {
    method: 'POST',
    headers: { ...AGENT_HEADERS, Accept: 'text/event-stream' },
    body: JSON.stringify({ input: text, stream: true, ...(model && { model }), ...(sessionId && { session_id: sessionId }) }),
  });
  // Failures before the turn starts (a busy session, a bad model id) come back as JSON.
  if (!upstream.headers.get('content-type')?.includes('text/event-stream') || !upstream.body) {
    throw new UpstreamError(upstream.status, await upstream.json().catch(() => null));
  }

  // The turn runs on the instance, not in this request. When the user presses Stop,
  // useChat aborts this request; cancel the turn on the instance too.
  let responseId: string | undefined;
  request.signal.addEventListener('abort', () => {
    if (responseId) agent37(instanceUrl(agent.id, `/v1/responses/${responseId}/cancel`), { method: 'POST' }).catch(() => {});
  });

  const stream = createUIMessageStream<AgentUIMessage>({
    execute: async ({ writer }) => {
      let block: { type: 'text' | 'reasoning'; id: string } | null = null;
      let blocks = 0;
      let sawText = false;
      const running: { toolCallId: string; tool: string }[] = [];

      const open = (type: 'text' | 'reasoning') => {
        if (block?.type === type) return block.id;
        close();
        block = { type, id: `${type}-${++blocks}` };
        writer.write({ type: `${type}-start`, id: block.id });
        return block.id;
      };
      const close = () => {
        if (block) writer.write({ type: `${block.type}-end`, id: block.id });
        block = null;
      };
      // A completion names the tool but not the call, so it finishes the oldest running
      // call of that tool.
      const finishTool = (tool: string | null, chunk: (toolCallId: string) => Parameters<typeof writer.write>[0]) => {
        const index = running.findIndex((call) => tool === null || call.tool === tool);
        if (index === -1) return;
        const [call] = running.splice(index, 1);
        writer.write(chunk(call.toolCallId));
      };

      for await (const { event, data } of sseEvents(upstream.body!)) {
        switch (event) {
          case 'response.created':
            responseId = data.id;
            writer.write({ type: 'start', messageMetadata: { sessionId: data.session_id } });
            break;
          case 'response.reasoning.delta':
            writer.write({ type: 'reasoning-delta', id: open('reasoning'), delta: data.text });
            break;
          case 'response.output_text.delta':
            sawText = true;
            writer.write({ type: 'text-delta', id: open('text'), delta: data.text });
            break;
          case 'response.tool_call.started': {
            close();
            const toolCallId = `call-${running.length}-${Date.now().toString(36)}`;
            running.push({ toolCallId, tool: data.tool });
            writer.write({
              type: 'tool-input-available',
              toolCallId,
              toolName: data.tool,
              title: data.label?.split('\n')[0],
              input: data.arguments ?? { summary: data.label ?? data.tool },
              dynamic: true,
            });
            break;
          }
          case 'response.tool_call.completed':
            finishTool(data.tool, (toolCallId) => ({ type: 'tool-output-available', toolCallId, output: { duration_ms: data.duration_ms ?? null }, dynamic: true }));
            break;
          case 'response.tool_call.failed':
            finishTool(data.tool, (toolCallId) => ({ type: 'tool-output-error', toolCallId, errorText: data.error || 'The tool call failed.', dynamic: true }));
            break;
          case 'response.completed':
            // The turn is over, so no tool is still running, whatever events were missed.
            while (running.length) finishTool(null, (toolCallId) => ({ type: 'tool-output-available', toolCallId, output: {}, dynamic: true }));
            // The terminal event carries the whole reply. Use it only when no deltas came.
            if (!sawText && data.output_text) writer.write({ type: 'text-delta', id: open('text'), delta: data.output_text });
            close();
            writer.write({ type: 'finish', messageMetadata: { usage: data.usage ?? null } });
            return;
          case 'response.failed':
            close();
            writer.write({ type: 'error', errorText: [data.error?.message || 'The turn failed.', data.error?.hint].filter(Boolean).join(' ') });
            return;
        }
      }
    },
    onError: (err) => String((err as Error)?.message || err),
  });
  return createUIMessageStreamResponse({ stream });
});
