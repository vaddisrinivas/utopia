import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { authorizeMcpRequest, type HeaderMap } from '../security/auth';
import { createWonderMcpSdkServer } from './sdk-server';

const MCP_BODY_LIMIT_BYTES = 256 * 1024;
const LOCAL_ORIGINS = new Set(['http://localhost', 'http://127.0.0.1', 'http://[::1]']);

function writeHttpError(res: any, status: number, message: string) {
  res.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
  });
  res.end(message);
}

function firstHeaderValue(headers: HeaderMap, name: string): string | undefined {
  const raw = headers[name];
  if (Array.isArray(raw)) {
    return typeof raw[0] === 'string' ? raw[0] : undefined;
  }
  return typeof raw === 'string' ? raw : undefined;
}

function configuredAllowedOrigins(): string[] {
  const configured = String(process.env.LIFEOS_MCP_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return configured.length > 0 ? configured : [...LOCAL_ORIGINS];
}

function parseContentLength(headers: HeaderMap): number | null {
  const value = firstHeaderValue(headers, 'content-length');
  if (value === undefined) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : NaN;
}

function rejectOversizedBody(req: any, res: any, maxBytes: number): boolean {
  const contentLength = parseContentLength(req.headers ?? {});
  if (contentLength === null) {
    return false;
  }
  if (!Number.isFinite(contentLength)) {
    writeHttpError(res, 400, 'Invalid Content-Length header');
    return true;
  }
  if (contentLength > maxBytes) {
    writeHttpError(res, 413, `Request body too large. Limit is ${maxBytes} bytes.`);
    return true;
  }
  return false;
}

export async function handleMcpRequest(req: any, res: any): Promise<boolean> {
  if (!req.url?.startsWith('/mcp')) {
    return false;
  }

  const auth = authorizeMcpRequest(req.headers ?? {});
  if (!auth.ok) {
    writeHttpError(res, auth.statusCode, auth.message);
    return true;
  }

  try {
    if (req.method === 'POST' && rejectOversizedBody(req, res, MCP_BODY_LIMIT_BYTES)) {
      return true;
    }
    const scope = auth.mcpScope ?? {
      domains: new Set<string>(),
      principal: auth.principalId,
      allowAllDomains: false,
    };
    const server = createWonderMcpSdkServer(scope);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
      enableDnsRebindingProtection: true,
      allowedOrigins: configuredAllowedOrigins(),
    });
    await server.connect(transport);
    await transport.handleRequest(req, res);
    return true;
  } catch (error) {
    if (!res.headersSent) {
      writeHttpError(res, 500, (error as Error).message);
    } else {
      res.end();
    }
    return true;
  }
}
