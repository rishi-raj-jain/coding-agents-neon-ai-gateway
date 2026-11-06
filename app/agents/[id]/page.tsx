import { Suspense } from 'react';
import { AgentChat } from '@/components/agent-chat';

// The agent id comes from the URL, which only exists at request time: the chat reads it
// with useParams inside this boundary, and the rest of the page prerenders.
export default function AgentPage() {
  return (
    <Suspense>
      <AgentChat />
    </Suspense>
  );
}
