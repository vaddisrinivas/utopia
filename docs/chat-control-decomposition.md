# Chat-Control Decomposition

## Ownership

| Concern | Owner |
| --- | --- |
| Run state, controller lifecycle, terminal transitions | `server/src/services/chat-control-service.ts` via `chat-control-repository.ts` |
| Send/retry execution, message persistence, response-id persistence | `ChatControlService.execute` |
| Retry target validation and scoped reservation | `ChatControlService.retry` and repository |
| Action proposal, conversation action, undo, ownership checks | `ChatControlService.action` / `ChatControlService.undo` and repository |
| Durable run/idempotency/action storage adapters | `chat-control-repository.ts` |
| HTTP auth, bounded body reads, status mapping | `server/src/routes/chat-control-routes.ts` |
| SSE framing and send request composition | `server/src/index.ts` |

## Intentional Remainder

`server/src/index.ts` still composes the general `/chat/send` and
`/chat/send/stream` HTTP flows. It owns request normalization, conversation
creation, cached idempotency response framing, and SSE events. It does not own
run-state mutation, controller registration, action/undo execution, retry
business logic, message persistence, or idempotency completion.

The remaining composition can move behind a dedicated send-route adapter later;
moving it in this change would duplicate streaming and cache behavior without
improving the service boundary.
