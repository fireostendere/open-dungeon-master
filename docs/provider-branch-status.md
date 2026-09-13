# Provider integration branch status

This branch currently publishes only provider validation, isolated storage and a bounded JSON-RPC transport, plus offline tests and CI. It does NOT yet enable ChatGPT login in the admin UI or integrate native game-tool inference. The main gateway upload was rejected by the editing tool. The existing application routes, profiles and main branch are unchanged.

Fast check, without installing dependencies or using any provider account:

```sh
node --test scripts/test-provider-core.mjs scripts/test-provider-transport.mjs
```

The workflow also runs the existing lint, complete test suite and build separately. Passing these checks establishes regression safety for the published subset, not real-account authentication or a playable campaign through Codex. Do not treat this branch as the completed provider-auth feature.
