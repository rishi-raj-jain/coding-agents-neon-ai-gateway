'use client';

// The chat page for one coding agent: sessions on the left, the conversation in the
// middle, and a model picker in the composer. useChat (AI SDK) holds the conversation
// and talks to /api/agents/[id]/chat, which streams the agent's turn as a UI message
// stream. AI Elements renders the parts: text, reasoning, and each tool call.
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Conversation, ConversationContent, ConversationEmptyState, ConversationScrollButton } from '@/components/ai-elements/conversation';
import { Message, MessageContent, MessageResponse } from '@/components/ai-elements/message';
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSelect,
  PromptInputSelectContent,
  PromptInputSelectItem,
  PromptInputSelectTrigger,
  PromptInputSelectValue,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from '@/components/ai-elements/prompt-input';
import { Reasoning, ReasoningContent, ReasoningTrigger } from '@/components/ai-elements/reasoning';
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from '@/components/ai-elements/tool';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import type { AgentUIMessage } from '@/lib/chat-types';
import { cn } from '@/lib/utils';

type AgentInfo = { id: string; name: string; harness: { id: string; label: string; models: { id: string; label: string }[] } };
type Session = { id: string; title?: string | null };

const STARTERS = [
  'Which model are you? Answer in one line.',
  'Write fizzbuzz.js in ~/demo for 1 to 15 and run it with node. Reply with its output on one comma-separated line.',
  'Clone github.com/sindresorhus/slugify, run its tests, and tell me how long they took.',
];

export function AgentChat() {
  const { id } = useParams<{ id: string }>();
  const [agent, setAgent] = useState<AgentInfo | null>(null);
  const [model, setModel] = useState('');
  const [sessions, setSessions] = useState<Session[]>([]);

  const loadSessions = useCallback(() => {
    api<{ data: Session[] }>(`/api/agents/${id}/sessions`)
      .then(({ data }) => setSessions(data.slice(0, 30)))
      .catch(() => {});
  }, [id]);

  // The harness keeps the conversation, so each request carries only the new text, the
  // model for this turn, and the session to continue.
  const transport = useMemo(
    () =>
      new DefaultChatTransport<AgentUIMessage>({
        api: `/api/agents/${id}/chat`,
        prepareSendMessagesRequest: ({ messages, body }) => {
          const last = messages.at(-1);
          const text = last?.parts.map((part) => (part.type === 'text' ? part.text : '')).join('') ?? '';
          return { body: { ...body, text } };
        },
      }),
    [id]
  );
  const { messages, sendMessage, setMessages, status, stop, error } = useChat<AgentUIMessage>({ id, transport, onFinish: loadSessions });

  // The session this conversation is in: the server puts it on every assistant message.
  const sessionId = messages.findLast((m) => m.metadata?.sessionId)?.metadata?.sessionId;
  const busy = status === 'submitted' || status === 'streaming';

  useEffect(() => {
    api<AgentInfo>(`/api/agents/${id}`).then((info) => {
      setAgent(info);
      setModel(info.harness.models[0]?.id || '');
    });
    loadSessions();
  }, [id, loadSessions]);

  async function openSession(sid: string) {
    if (busy) return;
    const { messages } = await api<{ messages: AgentUIMessage[] }>(`/api/agents/${id}/sessions/${sid}`);
    setMessages(messages);
  }

  const send = (text: string) => {
    if (!text.trim() || busy) return;
    sendMessage({ text }, { body: { model, sessionId } });
  };

  return (
    <div className="flex h-screen">
      <aside className="flex w-64 shrink-0 flex-col gap-2.5 overflow-y-auto border-r bg-background p-3.5">
        <Link className="text-sm text-muted-foreground hover:text-foreground" href="/">
          ← Agents
        </Link>
        <Button disabled={busy} onClick={() => setMessages([])}>
          New chat
        </Button>
        <nav className="flex flex-col gap-0.5">
          {sessions.map((s) => (
            <button
              key={s.id}
              title={s.title || s.id}
              onClick={() => openSession(s.id)}
              className={cn('truncate rounded-md px-2.5 py-2 text-left text-sm hover:bg-muted', s.id === sessionId && 'bg-muted font-medium')}
            >
              {s.title || 'Untitled session'}
            </button>
          ))}
        </nav>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col bg-background">
        <header className="border-b px-6 py-3.5 font-semibold">
          {agent?.harness.label || 'Agent'} <code className="font-normal text-muted-foreground">{id}</code>
        </header>

        <Conversation className="flex-1">
          <ConversationContent className="mx-auto w-full max-w-3xl">
            {messages.length === 0 ? (
              <ConversationEmptyState title={`Chat with ${agent?.name || 'the agent'}`} description="Every model call goes through this agent's own Neon AI Gateway credential.">
                <div className="mt-4 flex flex-col gap-2">
                  {STARTERS.map((prompt) => (
                    <Button key={prompt} variant="outline" className="h-auto whitespace-normal py-2 text-left" onClick={() => send(prompt)}>
                      {prompt}
                    </Button>
                  ))}
                </div>
              </ConversationEmptyState>
            ) : (
              messages.map((message) => <ChatMessage key={message.id} message={message} streaming={busy && message.id === messages.at(-1)?.id} />)
            )}
            {error && <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-sm text-destructive">{errorText(error)}</div>}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>

        <div className="mx-auto w-full max-w-3xl px-6 pb-5">
          <PromptInput onSubmit={({ text }) => send(text)}>
            <PromptInputBody>
              <PromptInputTextarea placeholder="Message the coding agent..." disabled={busy} />
            </PromptInputBody>
            <PromptInputFooter>
              <PromptInputTools>
                {agent && (
                  <PromptInputSelect value={model} onValueChange={setModel} disabled={busy}>
                    <PromptInputSelectTrigger>
                      <PromptInputSelectValue />
                    </PromptInputSelectTrigger>
                    <PromptInputSelectContent>
                      {agent.harness.models.map((m) => (
                        <PromptInputSelectItem key={m.id} value={m.id}>
                          {m.label}
                        </PromptInputSelectItem>
                      ))}
                    </PromptInputSelectContent>
                  </PromptInputSelect>
                )}
                <span className="text-xs text-muted-foreground">via Neon AI Gateway</span>
              </PromptInputTools>
              <PromptInputSubmit status={status} onStop={stop} />
            </PromptInputFooter>
          </PromptInput>
        </div>
      </main>
    </div>
  );
}

// A route that refuses before streaming answers { error: { message } }; useChat puts
// that body in the error's message.
function errorText(error: Error) {
  try {
    return JSON.parse(error.message).error?.message ?? error.message;
  } catch {
    return error.message;
  }
}

function ChatMessage({ message, streaming }: { message: AgentUIMessage; streaming: boolean }) {
  const cost = message.metadata?.usage?.cost_usd;
  return (
    <Message from={message.role}>
      <MessageContent>
        {message.parts.map((part, index) => {
          const key = `${message.id}-${index}`;
          switch (part.type) {
            case 'text':
              return message.role === 'assistant' ? <MessageResponse key={key}>{part.text}</MessageResponse> : <div key={key} className="whitespace-pre-wrap">{part.text}</div>;
            case 'reasoning':
              return (
                <Reasoning key={key} isStreaming={streaming && index === message.parts.length - 1}>
                  <ReasoningTrigger />
                  <ReasoningContent>{part.text}</ReasoningContent>
                </Reasoning>
              );
            case 'dynamic-tool':
              return (
                <Tool key={key}>
                  <ToolHeader
                    type="dynamic-tool"
                    state={part.state}
                    toolName={part.toolName}
                    title={part.title ? `${part.toolName}: ${part.title.slice(0, 80)}` : part.toolName}
                    className="text-left [&>div>span:first-of-type]:line-clamp-1"
                  />
                  <ToolContent>
                    <ToolInput input={part.input} />
                    <ToolOutput output={part.state === 'output-available' ? part.output : undefined} errorText={part.state === 'output-error' ? part.errorText : undefined} />
                  </ToolContent>
                </Tool>
              );
            default:
              return null;
          }
        })}
        {message.role === 'assistant' && cost != null && <div className="text-xs text-muted-foreground">About ${cost.toFixed(4)}, as the harness estimates it</div>}
      </MessageContent>
    </Message>
  );
}
