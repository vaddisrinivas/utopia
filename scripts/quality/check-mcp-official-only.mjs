import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const mcpDir = path.join(root, 'server', 'src', 'mcp');
const allowedFiles = new Set(['official-server.ts', 'scoped-access.ts', 'sdk-server.ts']);
const forbiddenPatterns = [
  /protocol-compat/i,
  /custom.*json-?rpc/i,
  /legacy.*mcp/i,
  /SSE.*parser/i,
  /event-stream.*parser/i,
];

const violations = [];

for (const entry of fs.readdirSync(mcpDir, { withFileTypes: true })) {
  if (!entry.isFile()) continue;
  if (!allowedFiles.has(entry.name)) {
    violations.push(`server/src/mcp/${entry.name}: MCP protocol surface must stay in official SDK glue only`);
  }
}

const officialServer = fs.readFileSync(path.join(mcpDir, 'official-server.ts'), 'utf8');
const sdkServer = fs.readFileSync(path.join(mcpDir, 'sdk-server.ts'), 'utf8');

if (!officialServer.includes('@modelcontextprotocol/sdk/server/streamableHttp.js')) {
  violations.push('server/src/mcp/official-server.ts: missing official StreamableHTTP transport import');
}
if (!officialServer.includes('new StreamableHTTPServerTransport')) {
  violations.push('server/src/mcp/official-server.ts: /mcp must use official StreamableHTTPServerTransport');
}
if (/jsonrpc/i.test(officialServer)) {
  violations.push('server/src/mcp/official-server.ts: preflight errors must not hand-roll JSON-RPC envelopes');
}
if (!sdkServer.includes('@modelcontextprotocol/sdk/server/index.js')) {
  violations.push('server/src/mcp/sdk-server.ts: missing official MCP Server import');
}
if (!sdkServer.includes('@modelcontextprotocol/sdk/types.js')) {
  violations.push('server/src/mcp/sdk-server.ts: missing official MCP request schemas/types');
}

for (const rel of ['server/src/mcp', 'spikes/mcp-sdk']) {
  const full = path.join(root, rel);
  if (!fs.existsSync(full)) continue;
  const files = fs.statSync(full).isDirectory()
    ? fs.readdirSync(full, { recursive: true }).map((item) => path.join(full, String(item)))
    : [full];
  for (const file of files) {
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) continue;
    const source = fs.readFileSync(file, 'utf8');
    for (const pattern of forbiddenPatterns) {
      if (pattern.test(file) || pattern.test(source)) {
        violations.push(`${path.relative(root, file)}: forbidden custom/legacy MCP protocol marker ${pattern}`);
      }
    }
  }
}

if (fs.existsSync(path.join(root, 'spikes', 'mcp-sdk'))) {
  violations.push('spikes/mcp-sdk: delete spike artifacts after official SDK convergence');
}

if (violations.length) {
  console.error('MCP official-only guard failed:');
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log('MCP official-only guard passed');
