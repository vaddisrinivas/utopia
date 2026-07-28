import { ServerChatResponse } from './chat';

export type ChatStreamEventType = 'run.start' | 'token' | 'run.end' | 'cache' | 'error';

export type ChatStreamEvent = {
  type: 'run.start';
  run_id: string;
  conversation_id: string;
  thread_id?: string;
} | {
  type: 'token';
  run_id: string;
  conversation_id: string;
  delta: string;
} | {
  type: 'run.end';
  run_id: string;
  conversation_id: string;
  response: ServerChatResponse;
} | {
  type: 'cache';
  conversation_id: string;
  response: ServerChatResponse;
} | {
  type: 'error';
  error: string;
  conversation_id?: string;
};
