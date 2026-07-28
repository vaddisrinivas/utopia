export type SourceCitation = {
  handle: string;
  type: string;
  url: string;
  snapshot_at: string;
};

import { RetrievalSnapshot } from './agents/retrieval';

export type NormalizedCitation = {
  label: string;
  detail: string;
  href: string;
  tone: 'moss' | 'blue' | 'amber';
};

export function normalizeCitations(citations: SourceCitation[]) {
  return citations.filter((item) => !!item.handle && !!item.url).map((item) => ({
    label: item.handle,
    detail: item.type,
    href: item.url,
    tone: 'moss',
  })) as NormalizedCitation[];
}

export function toCitationsFromSnapshots(snapshots: RetrievalSnapshot[] = []): NormalizedCitation[] {
  return snapshots.map((snapshot) => ({
    label: snapshot.label,
    detail: snapshot.detail,
    href: snapshot.url,
    tone: snapshot.tone,
  }));
}

export function makeConversationProvenance(input: {
  conversationId: string;
  query: string;
  sources: RetrievalSnapshot[];
  answerText: string;
}) {
  return {
    conversation_id: input.conversationId,
    query: input.query,
    sources: toCitationsFromSnapshots(input.sources),
    answer_text: input.answerText,
    generated_at: new Date().toISOString(),
  };
}

export function makeNoopProvenance(message: string) {
  return {
    answer_text: message,
    sources: [] as ReturnType<typeof normalizeCitations>,
    generated_at: new Date().toISOString(),
  };
}
