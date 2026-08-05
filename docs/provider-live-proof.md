# Provider Live Proof Runbook

Scope: Notion and Google Sheets live proof lane for Utopia.

## Readiness Contracts

Run `npm run check:live-provider-readiness` before live runs.
This is a preflight check only. It checks authorization wiring and guard wiring for live proof.
It does **not** prove any live write.

Readiness is grouped into blockers (smallest actionable units):

- Notion:
  - `notion_credentials` (needs `NOTION_TOKEN` or `NOTION_API_KEY`)
  - `notion_target_page` (`NOTION_TEST_PAGE_ID`)
  - `notion_account` (`NOTION_TEST_ACCOUNT_ID` or `NOTION_WORKSPACE_ID`)
  - `notion_guard_key` (`WONDERFOOD_DISPOSABLE_PROVIDER_AUTHORIZATION_KEY`)
  - `notion_guard_ack` (`WONDERFOOD_LIVE_PROVIDER_ACK` or `WONDERFOOD_LIVE_PROVIDER_ACK_NOTION`)
- Sheets:
  - `sheets_test_spreadsheet` (`GOOGLE_SHEETS_TEST_SPREADSHEET_ID`)
  - `sheets_oauth_source` (`GOOGLE_SHEETS_ACCESS_TOKEN` or `GOOGLE_SHEETS_TOKEN_FILE`)
  - `sheets_account` (`GOOGLE_SHEETS_TEST_ACCOUNT_ID` or `GOOGLE_ACCOUNT_ID`)
  - `sheets_oauth_client_id` (`GOOGLE_CLIENT_ID`)
  - `sheets_oauth_client_secret` (`GOOGLE_CLIENT_SECRET`)
  - `sheets_guard_key` (`WONDERFOOD_DISPOSABLE_PROVIDER_AUTHORIZATION_KEY`)
  - `sheets_guard_ack` (`WONDERFOOD_LIVE_PROVIDER_ACK` or `WONDERFOOD_LIVE_PROVIDER_ACK_SHEETS`)

For live execution, follow with `npm run check:live-providers` (or `./scripts/quality/run-provider-live-proofs.sh notion sheets`) after all blockers clear.

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
