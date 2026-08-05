import { serve } from '@hono/node-server';
import { createOpenAI } from '@ai-sdk/openai';
import { generateText } from 'ai';
import { Hono } from 'hono';
import { z, ZodError } from 'zod';
import { createDataHomes } from './data-homes';
import type { Provider } from '@/src/kernel/services';
import { JsonRecordSchema } from '@/src/kernel/runtime';

const Chat = z.object({ requestId: z.string().min(1).max(200), messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(20_000) })).max(100), context: z.unknown().optional() });
type Input = z.infer<typeof Chat>;
type Responder = (input: Input) => Promise<string>;

export function createApp(respond: Responder, homes: Record<string, Provider> = {}) {
  const app = new Hono();
  const responses = new Map<string, { text: string; toolCalls: unknown[] }>();
  app.onError((error, context) => context.json({ error: error.message }, error instanceof ZodError ? 400 : 500));
  app.get('/health', (context) => context.json({ ok: true }));
  app.post('/chat', async (context) => {
    const input = Chat.parse(await context.req.json());
    const cached = responses.get(input.requestId);
    if (cached) return context.json(cached);
    const result = { text: await respond(input), toolCalls: [] };
    responses.set(input.requestId, result);
    return context.json(result);
  });
  app.post('/data/:id/pull', async (context) => {
    const home = homes[context.req.param('id')];
    if (!home) return context.json({ error: 'Unknown data home' }, 404);
    const input = z.object({ cursor: z.string().optional() }).parse(await context.req.json());
    return context.json(await home.pull(input.cursor));
  });
  app.post('/data/:id/push', async (context) => {
    const home = homes[context.req.param('id')];
    if (!home) return context.json({ error: 'Unknown data home' }, 404);
    const input = z.object({ records: z.array(JsonRecordSchema), cursor: z.string().optional() }).parse(await context.req.json());
    return context.json(await home.push(input.records, input.cursor));
  });
  return app;
}

async function model(input: Input): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY missing');
  const provider = createOpenAI({ apiKey });
  const result = await generateText({ model: provider(process.env.OPENAI_MODEL ?? 'gpt-5-mini'), messages: input.messages });
  return result.text;
}

const configuredHomes = process.env.UTOPIA_DATA_HOMES ? createDataHomes(JSON.parse(process.env.UTOPIA_DATA_HOMES)) : {};
const app = createApp(model, configuredHomes);
if (import.meta.url === `file://${process.argv[1]}`) serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 8787) });
export default app;
