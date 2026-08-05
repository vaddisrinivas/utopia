import { serve } from '@hono/node-server';
import { createOpenAI } from '@ai-sdk/openai';
import { generateText } from 'ai';
import { createHash } from 'node:crypto';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z, ZodError } from 'zod';
import { createDataHomes } from './data-homes';
import type { Provider } from '@/src/kernel/services';
import { JsonRecordSchema } from '@/src/kernel/runtime';

const Chat = z.object({ requestId: z.string().min(1).max(200), messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(20_000) })).max(100), context: z.unknown().optional() });
type Input = z.infer<typeof Chat>;
type Responder = (input: Input) => Promise<string>;
type Result = { text: string; toolCalls: unknown[] };
type Scope = { tenant: string; apps: string[] };
export type ChatStore = { run(key: string, hash: string, create: () => Promise<Result>): Promise<Result> };

class Conflict extends Error {}
export function memoryChatStore(): ChatStore {
  const values = new Map<string, { hash: string; result: Promise<Result> }>();
  return { run(key, hash, create) {
    const existing = values.get(key);
    if (existing && existing.hash !== hash) throw new Conflict('Idempotency key reused with different input');
    if (existing) return existing.result;
    const result = create().catch((error) => { values.delete(key); throw error; });
    values.set(key, { hash, result });
    return result;
  } };
}

export function postgresChatStore(url: string): ChatStore {
  const db = drizzle(url);
  const ready = db.execute(sql`create table if not exists utopia_chat_results (
    scope_key text primary key, input_hash text not null, response_json jsonb not null
  )`);
  return { async run(key, hash, create) {
    await ready;
    return db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`);
      const found = await tx.execute(sql`select input_hash, response_json from utopia_chat_results where scope_key=${key}`);
      if (found.rows[0]) {
        if (found.rows[0].input_hash !== hash) throw new Conflict('Idempotency key reused with different input');
        return found.rows[0].response_json as Result;
      }
      const result = await create();
      await tx.execute(sql`insert into utopia_chat_results values (${key}, ${hash}, ${JSON.stringify(result)}::jsonb)`);
      return result;
    });
  } };
}

const keyHash = (value: string) => `sha256:${createHash('sha256').update(value).digest('hex')}`;
export function createApp(respond: Responder, homes: Record<string, Provider> = {}, options: {
  keys?: Record<string, Scope>; store?: ChatStore;
} = {}) {
  const app = new Hono<{ Variables: { scope: Scope; appId: string } }>();
  const store = options.store ?? memoryChatStore();
  app.onError((error, context) => context.json({ error: error.message }, error instanceof ZodError ? 400 : error instanceof Conflict ? 409 : 500));
  const authorize = async (context: Parameters<Parameters<typeof app.use>[1]>[0], next: () => Promise<void>) => {
    const token = context.req.header('authorization')?.match(/^Bearer (.+)$/)?.[1];
    const scope = token && options.keys?.[keyHash(token)];
    if (!scope) return context.json({ error: 'Unauthorized' }, 401);
    const tenant = context.req.header('x-utopia-tenant');
    const appId = context.req.header('x-utopia-app');
    if (tenant !== scope.tenant || !appId || (!scope.apps.includes('*') && !scope.apps.includes(appId))) {
      return context.json({ error: 'Forbidden' }, 403);
    }
    context.set('scope', scope);
    context.set('appId', appId);
    await next();
  };
  const ownDataHome = (context: Parameters<Parameters<typeof app.use>[1]>[0]) => {
    const tenant = context.get('scope').tenant;
    const appId = context.get('appId');
    const requested = context.req.param('id');
    const expected = `${tenant}:${appId}:`;
    if (!requested || !requested.startsWith(expected)) return undefined;
    return requested;
  };
  app.use('/chat', authorize);
  app.use('/data/*', authorize);
  app.use('/data/:id/*', async (context, next) => {
    if (!ownDataHome(context)) return context.json({ error: 'Forbidden' }, 403);
    await next();
  });
  app.get('/health', (context) => context.json({ ok: true }));
  app.post('/chat', async (context) => {
    const input = Chat.parse(await context.req.json());
    const scope = context.get('scope');
    const key = `${scope.tenant}:${context.get('appId')}:${input.requestId}`;
    const hash = keyHash(JSON.stringify(input));
    return context.json(await store.run(key, hash, async () => ({ text: await respond(input), toolCalls: [] })));
  });
  app.post('/data/:id/pull', async (context) => {
    const id = ownDataHome(context);
    if (!id) return context.json({ error: 'Forbidden' }, 403);
    const home = homes[id];
    if (!home) return context.json({ error: 'Unknown data home' }, 404);
    const input = z.object({ cursor: z.string().optional() }).parse(await context.req.json());
    return context.json(await home.pull(input.cursor));
  });
  app.post('/data/:id/push', async (context) => {
    const id = ownDataHome(context);
    if (!id) return context.json({ error: 'Forbidden' }, 403);
    const home = homes[id];
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
const configuredKeys = process.env.UTOPIA_API_KEY_HASHES
  ? z.record(z.string(), z.object({ tenant: z.string().min(1), apps: z.array(z.string().min(1)).min(1) })).parse(JSON.parse(process.env.UTOPIA_API_KEY_HASHES))
  : {};
const app = createApp(model, configuredHomes, {
  keys: configuredKeys,
  store: process.env.DATABASE_URL ? postgresChatStore(process.env.DATABASE_URL) : memoryChatStore(),
});
if (import.meta.url === `file://${process.argv[1]}`) serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 8787) });
export default app;
