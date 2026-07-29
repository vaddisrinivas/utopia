import { badRequest, handleBodyReadError, ok } from '../http-utils';
import { type PackageRegistry } from '../kernel/package-registry';

const PACKAGE_BODY_LIMIT_BYTES = 512 * 1024;

type PackageRoutesContext = {
  assertAuth: (req: any, res: any) => { ok: boolean } | null;
  readJsonBody: (req: any, maxBytes: number) => Promise<Record<string, unknown>>;
  packageRegistry: () => PackageRegistry;
  installReactiveRuntime: () => void;
};

function packageRegistryState(registry: PackageRegistry) {
  return {
    active: registry.getActive(),
    installations: registry.listAppInstallations(),
    receipts: registry.getReceipts(),
  };
}

export async function handlePackageRoutes(
  req: any,
  res: any,
  path: string,
  context: PackageRoutesContext,
): Promise<boolean> {
  if (path !== '/packages' && !path.startsWith('/packages/')) {
    return false;
  }

  if (!context.assertAuth(req, res)) {
    return true;
  }

  if (req.method === 'GET' && path === '/packages/active') {
    ok(res, {
      status: 'ok',
      ...packageRegistryState(context.packageRegistry()),
    });
    return true;
  }

  if (req.method === 'POST' && path === '/packages/preview') {
    let payload: { package?: unknown };
    try {
      payload = (await context.readJsonBody(req, PACKAGE_BODY_LIMIT_BYTES)) as typeof payload;
    } catch (error) {
      if (handleBodyReadError(res, error)) return true;
      badRequest(res, 'Invalid JSON');
      return true;
    }
    const preview = context.packageRegistry().preview(payload.package);
    ok(res, {
      status: preview.valid ? 'valid' : 'invalid',
      preview,
    });
    return true;
  }

  if (req.method === 'POST' && path === '/packages/change/preview') {
    let payload: { request?: unknown };
    try {
      payload = (await context.readJsonBody(req, PACKAGE_BODY_LIMIT_BYTES)) as typeof payload;
    } catch (error) {
      if (handleBodyReadError(res, error)) return true;
      badRequest(res, 'Invalid JSON');
      return true;
    }
    try {
      const preview = context.packageRegistry().previewChange(payload.request as never);
      ok(res, preview);
    } catch (error) {
      badRequest(res, error instanceof Error ? error.message : 'package_change_invalid');
    }
    return true;
  }

  if (req.method === 'POST' && path === '/packages/change/activate') {
    let payload: { request?: unknown; approval?: unknown };
    try {
      payload = (await context.readJsonBody(req, PACKAGE_BODY_LIMIT_BYTES)) as typeof payload;
    } catch (error) {
      if (handleBodyReadError(res, error)) return true;
      badRequest(res, 'Invalid JSON');
      return true;
    }
    try {
      const registry = context.packageRegistry();
      const active = registry.activateApprovedChange(payload.request as never, payload.approval as never);
      context.installReactiveRuntime();
      ok(res, {
        status: 'activated',
        active,
        receipt: registry.getReceipts().at(-1),
      });
    } catch (error) {
      badRequest(res, error instanceof Error ? error.message : 'package_change_approval_failed');
    }
    return true;
  }

  if (req.method === 'POST' && path === '/packages/activate') {
    badRequest(res, 'Direct package activation is disabled. Use /packages/change/preview then /packages/change/activate with a hash-bound approval receipt.');
    return true;
  }

  if (req.method === 'POST' && path === '/packages/rollback') {
    const registry = context.packageRegistry();
    const active = registry.rollback();
    context.installReactiveRuntime();
    ok(res, {
      status: active ? 'rolled_back' : 'no_previous_package',
      active,
      receipt: registry.getReceipts().at(-1),
    });
    return true;
  }

  badRequest(res, 'Route not found');
  return true;
}
