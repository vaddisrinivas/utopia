import { badRequest, handleBodyReadError, notFound, ok } from '../http-utils';
import {
  deleteHealthSnapshot,
  exportHealthSnapshots,
  listHealthSnapshots,
  saveHealthSnapshot,
} from '../health/snapshots';

const HEALTH_BODY_LIMIT_BYTES = 512 * 1024;

type HealthConnectRouteContext = {
  assertAuth: (req: any, res: any) => { ok: boolean } | null;
  readJsonBody: (req: any, maxBytes: number) => Promise<Record<string, unknown>>;
};

export async function handleHealthConnectRoute(
  req: any,
  res: any,
  path: string,
  context: HealthConnectRouteContext,
): Promise<boolean> {
  if (!path.startsWith('/health/connect')) {
    return false;
  }

  if (!context.assertAuth(req, res)) {
    return true;
  }

  if (req.method === 'GET' && path === '/health/connect/snapshots') {
    ok(res, { status: 'ok', provider: 'health_connect', snapshots: listHealthSnapshots() });
    return true;
  }

  if (req.method === 'GET' && path === '/health/connect/export') {
    res.setHeader('content-disposition', 'attachment; filename="utopia-health-connect-export.json"');
    ok(res, {
      status: 'ok',
      provider: 'health_connect',
      exported_at: new Date().toISOString(),
      snapshots: exportHealthSnapshots(),
    });
    return true;
  }

  if (req.method === 'POST' && path === '/health/connect/snapshot') {
    let payload: Record<string, unknown>;
    try {
      payload = await context.readJsonBody(req, HEALTH_BODY_LIMIT_BYTES);
    } catch (error) {
      if (handleBodyReadError(res, error)) {
        return true;
      }
      badRequest(res, 'Invalid JSON');
      return true;
    }
    const result = saveHealthSnapshot(payload as Parameters<typeof saveHealthSnapshot>[0]);
    if (!result.ok) {
      badRequest(res, result.message);
      return true;
    }
    ok(res, result);
    return true;
  }

  const snapshotMatch = path.match(/^\/health\/connect\/snapshot\/([^/]+)$/);
  if (req.method === 'DELETE' && snapshotMatch) {
    const result = deleteHealthSnapshot(decodeURIComponent(snapshotMatch[1]));
    if (!result.ok && result.status === 'not_found') {
      notFound(res, result.message);
      return true;
    }
    if (!result.ok) {
      badRequest(res, result.message);
      return true;
    }
    ok(res, result);
    return true;
  }

  badRequest(res, 'Route not found');
  return true;
}
