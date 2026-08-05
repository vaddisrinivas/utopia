# Utopia capability map

Current source of truth: package JSON + shared contracts + current CI gates.

## Platform

| Area | Status |
|---|---|
| JSON-render app surfaces | Active |
| A2UI-shaped package contract | Active |
| Package-owned routes/native capabilities | Active |
| Widget registry | Active, still growing |
| Safe package change templates | Active |
| AI chat / package editing | Partial |
| Notion / Sheets provider homes | Active, UX still improving |
| Official MCP SDK endpoint | Active |
| Custom MCP protocol code | Forbidden |

## App factory goal

Utopia should let one person create many useful apps by editing package/config files, not by writing bespoke React screens.

V1 target:

- schemas
- views
- actions
- widgets
- native capability declarations
- provider bindings
- theme tokens
- AI/package edit proposals

## Still not done

- Full AI package editor inside the app.
- Rich Notion/Linear-quality widget interactions.
- Magical OAuth/share/invite provider UX.
- Complete declarative native permission runtime.
- More app-package examples beyond food/health/plants.
