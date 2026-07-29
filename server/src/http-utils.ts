export function applyCors(req: any, res: any, allowedOrigins: Set<string>) {
  const origin = typeof req.headers?.origin === 'string' ? req.headers.origin : '';
  if (origin && allowedOrigins.has(origin)) {
    res.setHeader('access-control-allow-origin', origin);
    res.setHeader('vary', 'origin');
  }
  res.setHeader('access-control-allow-headers', 'content-type, authorization');
  res.setHeader('access-control-allow-methods', 'DELETE, GET, POST, OPTIONS');
}

export function json(value: unknown) {
  return JSON.stringify(value);
}

export function setJson(res: any, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(json(body));
}

export function unauthorized(res: any, message: string) {
  setJson(res, 401, { status: 'error', message });
}

export function badRequest(res: any, message: string) {
  setJson(res, 400, { status: 'error', message });
}

export function conflict(res: any, message: string) {
  setJson(res, 409, { status: 'error', message });
}

export function notFound(res: any, message: string) {
  setJson(res, 404, { status: 'error', message });
}

export function payloadTooLarge(res: any, message: string) {
  setJson(res, 413, { status: 'error', message });
}

export function requestTimeout(res: any, message: string) {
  setJson(res, 408, { status: 'error', message });
}

export function requestHeaderTooLarge(res: any, message: string) {
  setJson(res, 431, { status: 'error', message });
}

export function ok(res: any, body: unknown) {
  setJson(res, 200, body);
}

export class PayloadTooLargeError extends Error {}
export class RequestTimeoutError extends Error {}
export class RequestHeaderTooLargeError extends Error {}

export function handleBodyReadError(res: any, error: unknown) {
  if (error instanceof PayloadTooLargeError) {
    payloadTooLarge(res, error.message);
    return true;
  }
  if (error instanceof RequestTimeoutError) {
    requestTimeout(res, error.message);
    return true;
  }
  if (error instanceof RequestHeaderTooLargeError) {
    requestHeaderTooLarge(res, error.message);
    return true;
  }
  if (error instanceof Error && error.message === 'Invalid Content-Length header') {
    badRequest(res, error.message);
    return true;
  }
  return false;
}

export function parseContentLength(req: any): number | null {
  const raw = Array.isArray(req.headers?.['content-length'])
    ? req.headers['content-length'][0]
    : req.headers?.['content-length'];
  if (raw === undefined) {
    return null;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : NaN;
}

export async function readBoundedTextBody(
  req: any,
  maxBytes: number,
  limits: {
    bodyDeadlineMs: number;
    bodyChunkTimeoutMs: number;
  },
): Promise<string> {
  const contentLength = parseContentLength(req);
  if (contentLength !== null) {
    if (!Number.isFinite(contentLength)) {
      throw new Error('Invalid Content-Length header');
    }
    if (contentLength > maxBytes) {
      throw new PayloadTooLargeError(`Request body too large. Limit is ${maxBytes} bytes.`);
    }
  }

  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let settled = false;
    let chunkTimer: ReturnType<typeof setTimeout> | null = null;
    let deadlineTimer: ReturnType<typeof setTimeout> | null = null;

    const clearTimers = () => {
      if (chunkTimer) clearTimeout(chunkTimer);
      if (deadlineTimer) clearTimeout(deadlineTimer);
    };
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimers();
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onError);
      callback();
    };
    const armChunkTimer = () => {
      if (chunkTimer) clearTimeout(chunkTimer);
      chunkTimer = setTimeout(() => {
        req.destroy(new RequestTimeoutError(`Request body timed out after ${limits.bodyChunkTimeoutMs} ms without progress.`));
      }, limits.bodyChunkTimeoutMs);
    };
    const onError = (error: unknown) => finish(() => reject(error));
    const onEnd = () => finish(() => resolve(Buffer.concat(chunks).toString('utf-8')));
    const onData = (chunk: Buffer | string) => {
      armChunkTimer();
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      totalBytes += buffer.byteLength;
      if (totalBytes > maxBytes) {
        req.destroy(new PayloadTooLargeError(`Request body too large. Limit is ${maxBytes} bytes.`));
        return;
      }
      chunks.push(buffer);
    };

    deadlineTimer = setTimeout(() => {
      req.destroy(new RequestTimeoutError(`Request exceeded ${limits.bodyDeadlineMs} ms deadline.`));
    }, limits.bodyDeadlineMs);
    armChunkTimer();
    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
  });
}

export async function readJsonBody(
  req: any,
  maxBytes: number,
  limits: {
    bodyDeadlineMs: number;
    bodyChunkTimeoutMs: number;
  },
): Promise<Record<string, unknown>> {
  const raw = await readBoundedTextBody(req, maxBytes, limits);
  if (!raw.trim()) {
    return {};
  }
  return JSON.parse(raw) as Record<string, unknown>;
}
