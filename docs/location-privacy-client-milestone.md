# Client intent and identity milestone (R12-R13)

Branch: `feat/location-privacy-playwright`, following `73bed0223f88bd3e76b1f424c8546de89612de79`.

Location chat now owns an in-memory intent session per exact campaign/user identity. Ambiguous retries retain their UUID and exact frozen payload. Different input cannot replace an unresolved command. Identity changes dispose the old session, abort requests and invalidate late completions. The hook masks old navigation, messages and pending state immediately; old callbacks cannot retarget drafts to the new endpoint.

The location HTTP API accepts the optional `X-ODM-Expected-User` assertion. A cookie identity mismatch returns 409/identity_changed before spatial reads, ingress accounting or writes. This header never authenticates anyone or grants permissions. It also catches account changes in another browser tab before React has rerendered.

## WebMCP contract change

`odm_send_location_message` now requires `intentId`, `roomId`, `expectedRevision`, `kind` and `content`. Choose one UUID intentId per intended message and reuse every argument unchanged after an uncertain result. For say/do, obtain current roomId and revision with the list tool first. For OOC, pass null for roomId and expectedRevision. An intentional second identical message requires a different intentId. The adapter no longer fetches a new revision or generates a new UUID during retry. Registration and invocation abort signals cancel stale tools; no private draft is persisted to browser storage.

## Executed validation

```sh
node --experimental-vm-modules --test scripts/test-location-client-intents.mjs
```

9 tests passed on Node 22.16.0. Tests execute the actual session, hook, WebMCP callback and location HTTP route. React hooks/native registration/auth/service/zod are explicitly identified test doubles. A real local TCP/HTTP fixture drops a response after recording the command; the repeated model call submits identical bytes and the fixture records one logical intent, not two. This fixture is not the complete Next deployment or the real spatial command journal.

The session module passed a standalone strict TypeScript check. All four changed TypeScript sources transpiled without diagnostics. These are not a full project typecheck, React DOM test or production build.

A Chromium 144 native WebMCP probe was attempted against loopback HTTP, but navigation failed with `net::ERR_BLOCKED_BY_ADMINISTRATOR` before the API check ran. No browser policy was bypassed. Therefore native registration/call and real UI navigation remain unverified, not PASS and not evidence that the API is absent. Full R11 acceptance and domain/runtime blockers remain open.
