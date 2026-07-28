import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import process from 'node:process';

type JsonRpcEnvelope = {
  jsonrpc: '2.0';
  id?: string | number | null;
  result?: {
    content?: Array<{ type: string; text?: string }>;
    tools?: Array<{ name: string }>;
    resources?: Array<{ uri: string }>;
    [key: string]: unknown;
  };
  error?: { code?: number; message?: string };
};

type JsonRpcErrorEnvelope = {
  jsonrpc: '2.0';
  id?: string | number | null;
  error?: { code?: number; message?: string };
};

type HttpRequestLog = {
  time: string;
  id: string | number | null;
  method: string;
  tool?: string;
};

type McpToolResult = {
  content?: Array<{ type: string; text?: string }>;
  tools?: Array<{ name: string }>;
  resources?: Array<{ uri: string }>;
  [key: string]: unknown;
};

type WorkflowResult = {
  status?: 'completed' | 'failed';
  action?: { id?: string };
  changed_records?: string[];
  checkpoint?: { runId?: string };
};

type UndoResult = {
  status?: 'completed' | 'failed';
  action?: { status?: 'completed' | 'failed' | 'cancelled'; id?: string };
  undoResult?: { success?: boolean; message?: string };
};

const root = process.cwd();
const outDir = join(root, 'app', 'build', 'evidence', 'phase4-mcp-workflow-replay-http');
mkdirSync(outDir, { recursive: true });

const stateDir = mkdtempSync(join(tmpdir(), `wf-http-${randomBytes(4).toString('hex')}-`));
const runtimeStatePath = join(stateDir, 'wonder-runtime.json');
const checkpointPath = join(stateDir, 'workflow-runs.json');
const port = 19123;
const base = `http://127.0.0.1:${port}`;
const token = 'phase4-http-proof-token';

process.env = {
  ...process.env,
  WONDER_RUNTIME_STATE_PATH: runtimeStatePath,
  LIFEOS_WORKFLOW_CHECKPOINT_PATH: checkpointPath,
  LIFEOS_SERVER_TOKEN: token,
};

const runId = `phase4-http-${Date.now()}`;

function fail(message: string): never {
  throw new Error(message);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    fail(message);
  }
}

function parseToolResult<T>(value: McpToolResult): T {
  const text = value?.content?.[0]?.text;
  if (typeof text !== 'string') {
    fail('tool result payload missing content[0].text');
  }
  return JSON.parse(text) as T;
}

function parseMcpTextEnvelope(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object') {
    fail('tool result payload missing JSON payload');
  }
  const data = payload as { content?: Array<{ type: string; text?: string }>; [key: string]: unknown };
  if (Array.isArray(data.content) && data.content.length > 0) {
    const text = data.content[0]?.text;
    if (typeof text === 'string') {
      return JSON.parse(text);
    }
  }
  return payload;
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServerReady(): Promise<void> {
  for (let i = 0; i < 120; i += 1) {
    try {
      const response = await fetch(`${base}/health`, { method: 'GET' });
      if (response.ok) {
        return;
      }
    } catch {
      // retry
    }
    await wait(250);
  }
  fail(`server did not become ready at ${base}/health`);
}

function logRequest(entries: HttpRequestLog[], method: string, requestId: string | number | null, tool?: string) {
  entries.push({
    method,
    id: requestId,
    tool,
    time: new Date().toISOString(),
  });
}

function authHeaders(accept: string) {
  return {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    accept,
  };
}

async function postMcpResponse(params: {
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
  accept?: 'application/json' | 'text/event-stream' | 'application/json, text/event-stream';
}): Promise<JsonRpcEnvelope> {
  const response = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: authHeaders(params.accept ?? 'application/json, text/event-stream'),
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: params.id,
      method: params.method,
      params: params.params ?? {},
    }),
  });
  if (!response.ok) {
    throw new Error(`MCP call ${params.method} failed with HTTP ${response.status}`);
  }
  const envelope = (await response.json()) as JsonRpcEnvelope;
  return envelope;
}

async function postMcp(params: {
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
  accept?: 'application/json' | 'text/event-stream' | 'application/json, text/event-stream';
  toolName?: string;
}, requestLog: HttpRequestLog[]): Promise<McpToolResult> {
  const envelope = await postMcpResponse({ ...params });
  logRequest(requestLog, params.method, params.id, params.toolName);
  if (!envelope) {
    fail(`MCP call ${params.method} returned no result`);
  }
  if (params.method === 'notifications/initialized') {
    return {};
  }
  if (envelope.error) {
    fail(`MCP error for ${params.method}: ${envelope.error.message || 'unknown error'}`);
  }
  if (!envelope.result) {
    fail(`MCP call ${params.method} returned empty result`);
  }
  return envelope.result;
}

async function postMcpSse(params: {
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
  toolName?: string;
  expectedTools?: string[];
}, requestLog: HttpRequestLog[]): Promise<McpToolResult[]> {
  const response = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: authHeaders('application/json, text/event-stream'),
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: params.id,
      method: params.method,
      params: params.params ?? {},
    }),
  });
  logRequest(requestLog, params.method, params.id, params.toolName);
  if (!response.ok) {
    throw new Error(`MCP stream call ${params.method} failed with HTTP ${response.status}`);
  }
  const contentType = response.headers.get('content-type') || '';
  const bodyText = await response.text();
  if (contentType.includes('application/json')) {
    const parsed = JSON.parse(bodyText) as JsonRpcEnvelope;
    if (parsed.error) {
      fail(`MCP JSON streamable error for ${params.method}: ${JSON.stringify(parsed.error)}`);
    }
    const result = parsed.result ? [parseMcpTextEnvelope(parsed.result) as McpToolResult] : [];
    if (params.expectedTools) {
      const listed = result.flatMap((entry) => entry.tools?.map((tool) => tool.name) ?? []);
      for (const expected of params.expectedTools) {
        assert(listed.includes(expected), `streamable JSON response should include tool ${expected}`);
      }
    }
    return result;
  }
  assert(contentType.includes('text/event-stream'), `MCP stream call should return event stream or JSON, got ${contentType}`);
  const chunks = bodyText.split('\n\n').map((chunk) => chunk.trim()).filter(Boolean);
  assert(chunks.length > 0, `${params.method} stream response should contain SSE chunks`);
  const results: McpToolResult[] = [];

  for (const chunk of chunks) {
    const lines = chunk.split('\n').map((line) => line.trim());
    for (const line of lines) {
      if (!line.startsWith('data:')) {
        continue;
      }
      const raw = line.slice('data:'.length).trim();
      if (!raw) {
        continue;
      }
      const parsed = JSON.parse(raw) as McpToolResult | JsonRpcErrorEnvelope;
      assert((parsed as JsonRpcEnvelope).jsonrpc === '2.0', `${params.method} SSE event must include jsonrpc`);
      if ('error' in parsed) {
        fail(`MCP SSE error for ${params.method}: ${JSON.stringify((parsed as JsonRpcErrorEnvelope).error)}`);
      }
      if ('result' in parsed) {
        const envelope = parsed as { result?: unknown };
        if (envelope.result !== undefined) {
          results.push(parseMcpTextEnvelope(envelope.result) as McpToolResult);
        }
      }
    }
  }

  if (params.expectedTools) {
    const listed = results.flatMap((entry) => entry.tools?.map((tool) => tool.name) ?? []);
    for (const expected of params.expectedTools) {
      assert(listed.includes(expected), `stream response should include tool ${expected}`);
    }
  }

  return results;
}

async function expectJsonRpcToolError(params: {
  id: string | number;
  method: string;
  params: Record<string, unknown>;
}, requestLog: HttpRequestLog[]) {
  const response = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: authHeaders('application/json'),
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: params.id,
      method: params.method,
      params: params.params,
    }),
  });
  logRequest(requestLog, params.method, params.id);
  const text = await response.text();
  const envelope = text.length > 0 ? (JSON.parse(text) as JsonRpcEnvelope) : null;
  if (!response.ok) {
    if (envelope && typeof envelope.error?.code === 'number') {
      return;
    }
    fail(`MCP call ${params.method} failed with HTTP ${response.status}`);
  }
  if (envelope?.result && (envelope.result as { isError?: unknown }).isError === true) {
    return;
  }
  if (!envelope || !envelope.error) {
    fail(`${params.method} should return jsonrpc error for invalid input`);
  }
  assert(envelope.error.code === -32601 || envelope.error.code === -32602, 'invalid tool should return MCP error code');
}

function createHashDigest(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

(async () => {
  const mcpServer = await import('../../server/src/mcp/official-server');
  const state = await import('../../server/src/runtime/state');
  const checkpoints = await import('../../server/src/workflows/checkpoint');

  const mcpHandler = mcpServer.handleMcpRequest;
  const requestLog: HttpRequestLog[] = [];

  const httpServer = createServer(async (req, res) => {
    if (req.url === '/health' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }
    if (req.url?.startsWith('/mcp')) {
      await mcpHandler(req, res);
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_found' }));
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.listen(port, () => resolve());
    httpServer.on('error', reject);
  });

  const cleanup = () => {
    return new Promise<void>((resolve, reject) => {
      httpServer.close((error?: Error) => {
        if (error) {
          reject(error);
          return;
        }
        rmSync(stateDir, { recursive: true, force: true });
        resolve();
      });
    });
  };

  try {
    await waitForServerReady();

    const initialize = await postMcp(
      {
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2026-03-11',
        capabilities: {},
        clientInfo: { name: 'phase4-http-proof', version: '1' },
      },
      },
      requestLog,
    );
    assert(typeof (initialize as { protocolVersion?: unknown }).protocolVersion === 'string', 'initialize did not include protocolVersion');

    const streamTools = await postMcpSse(
      {
        id: 2,
        method: 'tools/list',
        expectedTools: ['utopia.run_workflow', 'utopia.undo_action'],
      },
      requestLog,
    );
    assert(streamTools.length > 0, 'tools/list stream should include payload');

    const toolList = await postMcp({ id: 3, method: 'tools/list' }, requestLog);
    const toolNames = (toolList as { tools?: unknown[] }).tools ?? [];
    const toolNamesFlat = toolNames
      .map((entry) => (typeof entry === 'object' && entry !== null && 'name' in entry ? String((entry as { name?: unknown }).name) : ''))
      .filter(Boolean);
    assert(toolNamesFlat.includes('utopia.run_workflow'), 'run_workflow tool missing from MCP tools list');
    assert(toolNamesFlat.includes('utopia.undo_action'), 'undo_action tool missing from MCP tools list');

    await postMcpSse(
      {
        id: 4,
        method: 'tools/call',
        params: {
          name: 'utopia.status',
          arguments: {},
        },
        toolName: 'utopia.status',
      },
      requestLog,
    );

    await postMcp({ id: 5, method: 'resources/list' }, requestLog);
    await postMcp({ id: 6, method: 'notifications/initialized' }, requestLog);

    await expectJsonRpcToolError({
      id: 7,
      method: 'tools/call',
      params: {
        name: 'utopia.nonexistent',
        arguments: {},
      },
    }, requestLog);

    const runPayload = parseToolResult<WorkflowResult>(
      await postMcp({
        id: 8,
        method: 'tools/call',
        toolName: 'utopia.run_workflow',
        params: {
          name: 'utopia.run_workflow',
          arguments: {
            actor: 'hearth',
            workflow: 'phase4_replay_workflow',
            domain: 'food',
            action_id: `${runId}-workflow`,
            idempotency_key: `${runId}-run`,
          },
        },
      }, requestLog),
    );
    assert(runPayload.status === 'completed', `run_workflow returned status ${String(runPayload.status)}`);
    assert(!!runPayload.action?.id, 'run_workflow returned no action id');
    const changedRecords = runPayload.changed_records ?? [];
    assert(Array.isArray(changedRecords), 'run_workflow returned non-array changed_records');
    assert(changedRecords.length === 2, `expected 2 workflow records, got ${changedRecords.length}`);
    const checkpointRunId = runPayload.checkpoint?.runId;
    assert(typeof checkpointRunId === 'string' && checkpointRunId.length > 0, 'run_workflow did not return checkpoint run id');

    for (const recordId of changedRecords) {
      const readPayload = parseToolResult<{ record?: { id?: string } }>(
        await postMcp({
          id: randomBytes(4).readUInt32LE(0),
          method: 'tools/call',
          toolName: 'utopia.read_record',
          params: {
            name: 'utopia.read_record',
            arguments: { id: recordId },
          },
        }, requestLog),
      );
      assert(readPayload.record?.id === recordId, `expected created record ${recordId} before undo`);
    }

    const createArgs = {
      actor: 'hearth',
      domain: 'food',
      collection: 'recipe',
      title: 'phase4-http-probe',
      data_home: 'local_sqlite',
      idempotency_key: `${runId}-create`,
      action_id: `${runId}-create-action`,
    };
    const createPayload = parseToolResult<{ action?: { id?: string }; record?: { id?: string }; replayed?: boolean }>(
      await postMcp({
        id: 9,
        method: 'tools/call',
        toolName: 'utopia.create_record',
        params: {
          name: 'utopia.create_record',
          arguments: createArgs,
        },
      }, requestLog),
    );
    assert(typeof createPayload.record?.id === 'string', 'create_record did not return record id');
    assert(typeof createPayload.action?.id === 'string', 'create_record did not return action id');

    const createReplay = parseToolResult<{ replayed?: boolean }>(
      await postMcp({
        id: 10,
        method: 'tools/call',
        toolName: 'utopia.create_record',
        params: {
          name: 'utopia.create_record',
          arguments: createArgs,
        },
      }, requestLog),
    );
    assert(createReplay.replayed === true, 'create_record replay flag not returned');

    const recordId = createPayload.record?.id as string;
    const updatedPayload = parseToolResult<{ replayed?: boolean }>(
      await postMcp({
        id: 11,
        method: 'tools/call',
        toolName: 'utopia.update_record',
        params: {
          name: 'utopia.update_record',
          arguments: {
            actor: 'hearth',
            id: recordId,
            data_home: 'local_sqlite',
            patch: { title: 'phase4-http-probe updated' },
            idempotency_key: `${runId}-update`,
            action_id: `${runId}-update-action`,
          },
        },
      }, requestLog),
    );
    assert(updatedPayload !== undefined, 'update_record returned empty payload');

    const mismatchPayload = parseToolResult<{ allowed?: boolean; policy?: unknown; message?: string }>(
      await postMcp({
        id: 12,
        method: 'tools/call',
        toolName: 'utopia.update_record',
        params: {
          name: 'utopia.update_record',
          arguments: {
            actor: 'hearth',
            id: recordId,
            data_home: 'notion',
            patch: { title: 'should fail' },
          },
        },
      }, requestLog),
    );
    assert(
      mismatchPayload.allowed === false && typeof mismatchPayload.message === 'string',
      'provider-mismatch update did not return review-only failure',
    );

    const undoPayload = parseToolResult<UndoResult>(
      await postMcp({
        id: 13,
        method: 'tools/call',
        toolName: 'utopia.undo_action',
        params: {
          name: 'utopia.undo_action',
          arguments: {
            actor: 'hearth',
            actionId: runPayload.action.id as string,
            idempotency_key: `${runId}-undo`,
          },
        },
      }, requestLog),
    );
    assert(undoPayload.status === 'completed', `undo_action returned ${String(undoPayload.status)}`);
    assert(undoPayload.undoResult?.success === true, 'undo_action did not report success');

    const readReplay = parseToolResult<{ action?: { status?: 'completed' | 'failed' | 'cancelled' }; status?: 'completed' | 'failed' | 'cancelled'; }>(
      await postMcp({
        id: 14,
        method: 'tools/call',
        toolName: 'utopia.undo_action',
        params: {
          name: 'utopia.undo_action',
          arguments: {
            actor: 'hearth',
            actionId: runPayload.action.id as string,
            idempotency_key: `${runId}-undo`,
          },
        },
      }, requestLog),
    );
    assert(
      readReplay.action?.status === 'completed' || readReplay.status === 'completed',
      'undo_action idempotent replay did not complete',
    );

    for (const recordId of changedRecords) {
      let missing = false;
      try {
        await postMcp({
          id: randomBytes(4).readUInt32LE(0),
          method: 'tools/call',
          toolName: 'utopia.read_record',
          params: {
            name: 'utopia.read_record',
            arguments: { id: recordId },
          },
        }, requestLog);
      } catch {
        missing = true;
      }
      assert(missing, `record ${recordId} should be deleted after undo`);
    }

    const actionLog = state.getActionEvent(createPayload.action?.id ?? '');
    const checkpoint = state.getActionEvent(runPayload.action?.id ?? '');
    const checksum = {
      action_hash: createHashDigest({ action: createPayload.action?.id, run: runPayload.action?.id, checkpoint: checkpointRunId }),
      calls: requestLog.length,
    };

    const protocolVersion = (initialize as { protocolVersion?: string }).protocolVersion;
    const outPath = join(outDir, 'phase4-mcp-workflow-replay-http-proof.json');
    const proof = {
      proof: 'phase4_mcp_workflow_replay_http',
      evidence: {
        workflow_id: 'phase4_replay_workflow',
        action_id: runPayload.action.id,
        changed_records: changedRecords,
        checkpoint_run_id: checkpointRunId,
        protocol: protocolVersion,
        checks: {
          run_tool_visible: toolNamesFlat.includes('utopia.run_workflow'),
          undo_tool_visible: toolNamesFlat.includes('utopia.undo_action'),
          undo_success: undoPayload.undoResult?.success,
          changed_records_count: changedRecords.length,
          contract_create_replay: createReplay.replayed === true,
          mismatch_rejected: mismatchPayload.allowed === false,
          request_hash: checksum.action_hash,
          checkpoint_rows: checkpoints.getWorkflowCheckpoint(checkpointRunId)?.steps.length ?? 0,
          stream_tools_request_count: requestLog.filter((entry) => entry.method === 'tools/list' && entry.id !== 2).length + 1,
          stream_supported: requestLog.some((entry) => entry.method === 'tools/list' && entry.id === 2),
        },
        streamable: {
          call_count: requestLog.filter((entry) => entry.method === 'tools/call').length,
          request_count: requestLog.length,
          ids: requestLog.map((entry) => entry.id),
        },
      },
      state_files: {
        runtime_state_path: runtimeStatePath,
        checkpoint_path: checkpointPath,
      },
      local_action: actionLog ? { id: actionLog.id, status: actionLog.status } : null,
      all_passed: true,
    };
    writeFileSync(outPath, JSON.stringify(proof, null, 2), 'utf-8');
    console.log(`PASS ${outPath}`);
    process.stdout.write(JSON.stringify(proof, null, 2));
  } finally {
    await cleanup();
  }
})().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
