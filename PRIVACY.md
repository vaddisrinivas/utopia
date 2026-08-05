# Privacy

Utopia is local-first. Core food records are stored in the app's private Android
database by default, and the app remains usable without an account or network. The
repository contains generic test fixtures only and bundles no user data.

Current policy mirrors source snapshot `fd8e2e6`. Older proof artifacts and release notes are historical evidence, not policy overrides.

Users can choose a different data home during onboarding or later in Settings:

- Local SQLite keeps the food workspace on this Android device.
- Google Sheets stores a canonical Utopia snapshot in the selected spreadsheet
  after Google authorization.
- Notion appends canonical Utopia snapshot blocks to the selected page after
  page access is verified.
- Supabase/PostgREST/Utopia server writes a canonical snapshot to the configured
  HTTPS API for the selected household.
- Advanced direct PostgreSQL DSN mode stores the connection secret for explicit
  advanced use; it does not perform direct mobile writes without a server-side adapter.

Data leaves the device only after a user-triggered action:

- Choosing a remote data home exports the current Utopia snapshot to that provider.
- Sending a prompt or receipt to a configured AI provider sends the visible request
  plus relevant in-app food context needed for that request.
- Health Connect access uses Android's permission flow and only the declared record types.
- Google Drive backup uploads an encrypted archive to the app-data folder.
- CSV export, Android sharing, and command links expose the content the user selects.

Before a backend switch is committed, Utopia creates a local rollback snapshot.
Android automatic cloud backup and device-transfer backup are disabled. Provider keys,
OAuth access tokens, Notion tokens, API tokens, and connection strings are encrypted
with Android Keystore and excluded from backups. Clearing app data removes local
records, provider configuration, and saved credentials on that device.

Project operators deploying a fork must publish a privacy policy matching their chosen
AI providers, OAuth configuration, telemetry, distribution channel, and jurisdiction.
