import { getRequestListener } from '@hono/node-server';
import { Hono } from 'hono';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readNotionConfig } from './providers/notion/client';
import { readSheetsConfig } from './providers/sheets/client';
import { canExposeProviderStatusIds, type HeaderMap } from './security/auth';

const honoReadRoutes = new Hono();
const honoReadRouteKeys = new Set(['GET /health', 'GET /providers/status']);

function toHeaderMap(headers: Headers): HeaderMap {
  const mapped: HeaderMap = {};
  headers.forEach((value, key) => {
    mapped[key] = value;
  });
  return mapped;
}

honoReadRoutes.get('/health', (c) => {
  return c.json({ status: 'ok', service: 'utopia-server' });
});

honoReadRoutes.get('/providers/status', (c) => {
  const notion = readNotionConfig();
  const sheets = readSheetsConfig();
  const exposeIds = canExposeProviderStatusIds(toHeaderMap(c.req.raw.headers));
  return c.json({
    status: 'ok',
    authority: process.env.LIFEOS_AUTHORITY_PROVIDER?.trim() || 'notion',
    providers: {
      notion: {
        configured: Boolean(notion),
        data_source_id: exposeIds ? notion?.dataSourceId || null : null,
        api_version: notion?.apiVersion || null,
        webhook_configured: Boolean(notion?.webhookSigningSecret),
      },
      google_sheets: {
        configured: Boolean(sheets),
        spreadsheet_id: exposeIds ? sheets?.spreadsheetId || null : null,
        data_source_id: exposeIds ? sheets?.dataSourceId || null : null,
        workbook_name: sheets?.workbookName || null,
      },
      openai: {
        configured: Boolean(process.env.OPENAI_API_KEY?.trim()),
        model: process.env.OPENAI_MODEL?.trim() || 'gpt-4.1-mini',
      },
    },
    secrets_exposed: false,
  });
});

const honoReadRouteListener = getRequestListener(honoReadRoutes.fetch, {
  overrideGlobalObjects: false,
});

export function isHonoReadRoute(method: string | undefined, path: string): boolean {
  return honoReadRouteKeys.has(`${method ?? ''} ${path}`);
}

export async function handleHonoReadRoute(req: IncomingMessage, res: ServerResponse): Promise<void> {
  await honoReadRouteListener(req, res);
}
