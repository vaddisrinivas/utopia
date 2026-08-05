# GitHub App Factory

Fork-safe path for turning one plain-English request into a reviewable Utopia app package.

## User flow

1. Fork the repo.
2. Add a repository secret named `OPENAI_API_KEY`.
3. Edit `requests/app-idea.md` in plain English, or create an issue from the `Utopia app request` template in your fork.
4. Run the `Generate Utopia App` workflow, or let the labeled issue trigger it.
5. Download the generated artifact and review it before install.

## Secret contract

- The AI generation step requires `OPENAI_API_KEY`.
- The key is read only from GitHub Actions secrets.
- The key is never written to generated files.
- The workflow does not run on `pull_request`.
- If the secret is missing, CI exits successfully with a skipped summary instead of marking the repo red.

GitHub does not pass normal Actions secrets to workflows triggered by pull requests from forks, so the AI-backed path runs on `workflow_dispatch`, push, or labeled issue events inside the user's fork.

## Output

The artifact contains:

- `prompt.md`
- `source/`
- `package.json`
- `preview.json`
- `raw-model-output.json`
- `manifest.json`

Output is review-only. It is not installed or deployed automatically.

## Safety model

The model returns structured package-source JSON. The local compiler then validates:

- package source shape
- collection/query/screen links
- package contract validity
- checksum and preview metadata

Generation is skipped when the key is missing. When generation runs, it fails closed on empty prompt, invalid model output, or compiler errors.

## Notes

- This workflow is the default creator path, not a side demo.
- It targets record, relation, workflow, dashboard, and widget-backed tool apps first.
- It can now request declarative widgets for calculators, charts, forms, maps, media, timers, boards, and lightweight game surfaces.
- It still does not promise arbitrary custom engines like drawing tools, video editors, or code editors.
- Generated output must pass local package compilation before it becomes an artifact.
- Install stays separate from generation so users can inspect trust state first.
- Issue-triggered generation only runs when the issue has the `utopia-app-request` label.

## Example requests

- `requests/examples/habit-graph.md`
- `requests/examples/family-minesweeper.md`
- `requests/examples/timer-tool.md`
