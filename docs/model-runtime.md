# Applied model context and request limits

Applying a saved profile now records a non-secret runtime snapshot, rather than
trying to rediscover the profile later by its URL and model name. Two campaigns
can apply different context/output limits to the same endpoint without borrowing
one another's historical profile. Editing or deleting a saved profile does not
silently alter a campaign's applied snapshot; reapply explicitly to change it.

The snapshot contains the selected profile ID, endpoint/model, declared context,
verification flag, output cap, timeout and thinking mode. API keys are not copied
into this object. Global settings and their snapshot are committed together in a
SQLite transaction. Campaign settings carry the snapshot in their existing JSON.
Switching to a different target invalidates mismatching snapshot metadata.

`storyContextTokens` resolves the same campaign snapshot used by the request
router. The declared limit, an explicit `OPENAI_COMPAT_CONTEXT` and a positive
backend `/props` measurement are caps: the smallest known limit wins. A larger
override does not enlarge a smaller declared or measured window. Legacy/manual
custom targets with no known limit retain the 16384-token fallback. Native Ollama
continues to use its native/local context configuration.

The request router reserves room for the actual output cap, including an estimate
for tools, message framing and images. It refuses an estimated overfull request
with `MODEL_CONTEXT_EXCEEDED` instead of silently dropping authoritative input or
sending an unlimited output request. The estimate is **not a provider tokenizer
and is not a mathematical upper bound**. Image token costs and non-text provider
metadata vary. `estimatedInputTokens` is explicitly an estimate; backend usage is
the authority for actual token counts. Large schemas or long tool loops can still
require increasing the configured context or reducing supplied content.

The compatible transport, native Ollama transport and context probe now use the
same DNS-pinned endpoint fetcher as model connection probes. Strict-cloud requests
retain their separate provider-metadata handling and respect the resolved per-call
output cap. Provider credentials remain bound to their configured endpoint.

## Verification

`node --test scripts/test-review-runtime.mjs` executes 20 behavioral checks. They
use the real runtime/profile/client modules, an actual temporary SQLite database,
and explicit schema/provider/framework test doubles. Covered cases include two
independent campaign profiles, global transaction rollback, snapshot sanitation,
context/output caps, compatible SSE, native NDJSON, bounded parameter retries,
image fallback, credential routing and strict-cloud output-cap propagation.

These tests do not constitute a full TypeScript project check, Next production
build, browser session, live-provider probe or encrypted-production DB migration.
