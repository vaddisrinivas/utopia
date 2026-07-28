import { readSheetsConfig } from './client';

export type SheetsHealth = {
  status: 'ok' | 'warning' | 'blocked';
  configured: boolean;
  checks: Array<{ name: string; status: 'ok' | 'warning' | 'blocked'; message: string }>;
};

export function checkSheetsHealth(): SheetsHealth {
  const config = readSheetsConfig();
  if (!config) {
    return {
      status: 'blocked',
      configured: false,
      checks: [{ name: 'access_token', status: 'blocked', message: 'GOOGLE_SHEETS_ACCESS_TOKEN missing.' }],
    };
  }

  const checks: Array<{ name: string; status: SheetsHealth['checks'][number]['status']; message: string }> = [
    {
      name: 'access_token',
      status: 'ok',
      message: 'Google Sheets access token present.',
    },
    {
      name: 'spreadsheet_id',
      status: config.spreadsheetId ? 'ok' : ('warning' as const),
      message: config.spreadsheetId ? 'Spreadsheet id is present.' : 'Missing spreadsheet id.',
    },
  ];

  const allOk = checks.every((check) => check.status === 'ok');
  return {
    status: allOk ? 'ok' : 'warning',
    configured: allOk,
    checks,
  };
}
