# Audio Loop Android media-session / App Actions intent contract

Location: `src/platform/incoming-audio-loop.ts`.

Accepted inbound routes:

- Open app entry:
  - `utopia://audio-loop-108/open`
  - `utopia://audio-loop-108/open-audio-loop`
  - `utopia://audio-loop-108/start-audio-loop-voice`
- Media-style commands:
  - `command=play`
  - `command=pause`
  - `command=next`
  - `command=previous`
  - `command=loop-count` with one loop payload field:
  - `count=7`
  - `count=infinite`
  - `loopCount=7`
  - `loop-count=infinite`

Parser proof boundary:

- `tests/platform/audio-loop-intent.test.ts` validates parser output only (pure input/output mapping).
- No native media-session runtime behavior, Google Assistant surface behavior, or device execution is validated by this contract.

Behavior:

- Unknown app-target routes return `{ kind: 'noop', reason: '...' }` with an explicit reason.
- Non-matching hosts/paths still return `null`.
- No-op results are deterministic and parse-only.
