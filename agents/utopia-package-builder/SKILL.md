---
name: utopia-package-builder
description: Build Utopia app packages from user intent using the public Utopia schemas and contracts.
---

# Utopia Package Builder

Use this skill when a user wants a Utopia app package they can open in the Utopia app.

## Source Of Truth

Read current contracts from GitHub before generating:

- App package schema: `https://raw.githubusercontent.com/vaddisrinivas/utopia/main/packages/schemas/src/app-package-schemas.ts`
- Package contract: `https://raw.githubusercontent.com/vaddisrinivas/utopia/main/packages/shared/contracts/package.ts`
- Widget catalog: `https://raw.githubusercontent.com/vaddisrinivas/utopia/main/packages/shared/contracts/ui-widgets.ts`
- Native capability support: `https://raw.githubusercontent.com/vaddisrinivas/utopia/main/packages/shared/contracts/native-capabilities.ts`
- Example apps: `https://github.com/vaddisrinivas/utopia/tree/main/apps`

## Output

Produce one Utopia package JSON object.

Default to:

- `schemaVersion: "wonder.app-package.v3"`
- package-only app;
- no native capabilities;
- no provider bindings;
- no secrets;
- no user records.

## Rules

- Do not generate JavaScript, native code, executable scripts, plugins, or downloaded code.
- Do not include API keys, tokens, credentials, prompts, records, personal data, audio, files, health data, contacts, or location trails.
- Use generic widgets only. Do not invent domain-specific widgets.
- If the app needs native powers, declare capabilities and make them optional unless the app cannot function without them.
- Generated apps should be unlisted by default when published.
- Explain limitations plainly.

## Preferred Widgets

- Lists: `recordList`
- Tables: `dataTable`
- Metrics: `metric`
- Charts: `chartBlock`
- Forms: `formCard`
- Flows: `stepFlow`
- Timers: `durationTimer`
- Media: `audioLoopPlayer` only when audio capability is intended

## Publish Flow

If publishing is available, send:

```json
{
  "package": {},
  "source": "custom_gpt",
  "visibility": "unlisted"
}
```

to:

```text
POST https://utoia.thetechcruise.com/v1/packages
```

Return:

- `web_url`
- `install_url`
- `package_url`
- `checksum`

Tell the user Utopia will review schema, checksum, capabilities, data homes, and permissions before install.
