# Provider Live Proof Runbook

Scope: Notion and Google Sheets live proof lane for Utopia.

## Readiness Contracts

Run `npm run check:live-provider-readiness` before live runs.

- Notion blockers must be config names only:
  - `NOTION_TOKEN` or `NOTION_API_KEY`
  - `NOTION_TEST_PAGE_ID`
  - `NOTION_TEST_ACCOUNT_ID` or `NOTION_WORKSPACE_ID`
  - `WONDERFOOD_DISPOSABLE_PROVIDER_AUTHORIZATION_KEY`
  - `WONDERFOOD_LIVE_PROVIDER_ACK` or `WONDERFOOD_LIVE_PROVIDER_ACK_NOTION`
- Sheets blockers must be config names only:
  - `GOOGLE_SHEETS_TEST_SPREADSHEET_ID`
  - `GOOGLE_SHEETS_PROVISION_DISPOSABLE=1` (optional; requires OAuth flow and creates a disposable workbook)
  - `GOOGLE_SHEETS_ACCESS_TOKEN` or `GOOGLE_SHEETS_TOKEN_FILE`
  - `GOOGLE_SHEETS_TEST_ACCOUNT_ID` or `GOOGLE_ACCOUNT_ID`
  - `GOOGLE_CLIENT_ID`
  - `GOOGLE_CLIENT_SECRET`
  - `WONDERFOOD_DISPOSABLE_PROVIDER_AUTHORIZATION_KEY`
  - `WONDERFOOD_LIVE_PROVIDER_ACK` or `WONDERFOOD_LIVE_PROVIDER_ACK_SHEETS`

## Browser OAuth path (Sheets)

If `GOOGLE_SHEETS_ACCESS_TOKEN` is not set, run:

```bash
./scripts/quality/run-google-sheets-live-proof.sh
```

This opens a browser OAuth flow for the disposable account and stores token material in
`GOOGLE_SHEETS_TOKEN_FILE` (or `build/evidence/live-workspace/google-sheets-token.json` by default).

Set `GOOGLE_SHEETS_PROVISION_DISPOSABLE=1` with `GOOGLE_SHEETS_TEST_SPREADSHEET_ID` unset to have
`run-google-sheets-live-proof.sh` create a fresh disposable workbook automatically.

## Live Run Commands

- `./scripts/quality/run-provider-live-proofs.sh notion sheets`
- `npm run check:live-providers`
- `npm run check:notion-data-home`
- `npm run check:google-sheets-data-home`

## Evidence

- Readiness payload: `app/build/evidence/live-provider-readiness.json`
- Notion scenario proof evidence: `app/build/evidence/live-workspace/notion_scenarios-*.json`
- Direct writeback evidence: `app/build/evidence/live-workspace/direct_provider_writeback-*.json`
