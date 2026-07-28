import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertServerExecuteGate, localQuery, runChatAgent } from '../../server/src/agents/chat-agent';

const evidencePath = join(process.cwd(), 'app', 'build', 'evidence', 'local-query-contract');

async function run() {
  mkdirSync(evidencePath, { recursive: true });

  const originalKey = process.env.OPENAI_API_KEY;
  try {
    delete process.env.OPENAI_API_KEY;

    assert.equal('execute' in (localQuery as Record<string, unknown>), false, 'localQuery tool must not expose execute for server runs');
    assert.equal(typeof (localQuery as Record<string, unknown>).inputSchema, 'object', 'localQuery should expose schema input only');
    assert.equal(typeof (localQuery as Record<string, unknown>).outputSchema, 'object', 'localQuery should expose schema output for client continuation');
    assertServerExecuteGate(localQuery);

    const disabled = await runChatAgent({ prompt: 'localQuery server contract probe', stream: false });
    assert.equal(disabled.status, 'disabled', 'runChatAgent should return disabled without provider key');
    assert.equal(disabled.source, 'openai-provider-missing', 'disabled provider path should surface as openai-provider-missing');
    assert.equal(disabled.webCitations.length, 0, 'disabled path should not emit citations');
    assert.equal(disabled.toolCalls.length, 0, 'disabled path should not emit tool calls');
    assert.equal(disabled.duplicateToolCallIds.length, 0, 'disabled path should not emit duplicates');
    assert.equal(disabled.responseId?.startsWith('offline:'), undefined, 'disabled path must not create synthetic response ids');

    writeFileSync(
      join(evidencePath, 'local-query-server-contract-proof.json'),
      JSON.stringify(
        {
          check: 'local-query-server-contract',
          disabled_path: disabled.status,
          tool_call_ids_gate: true,
          output_schema_gate: true,
          synthetic_response_id_gate: true,
          run_chat_agent_source: disabled.source,
        },
        null,
        2,
      ),
    );
  } finally {
    if (originalKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalKey;
    }
  }
}

run().then(
  () => {
    console.log('localQuery server contract checks: passed');
  },
  (error: unknown) => {
    console.error('localQuery server contract checks: failed', error);
    process.exit(1);
  },
);
