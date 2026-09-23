# Voice call workspace

This change replaces the call UI in `dungeon_master`, not `my-voice-chat`, and
keeps the existing mediasoup SFU, mesh compatibility and authenticated routes.
No production hostnames, server configuration, secrets or database schema change.

## What players get

- One call window with participant cards/list, room-local search, speaking/hand/
  turn-muted states and individual volume, local mute and reset controls.
- A wider desktop dialog, an expanded view and a mobile bottom sheet. The call
  controller stays mounted when the window closes, expands or changes tabs.
  Escape, focus return, focus containment and keyboard-operable tabs are included.
- Sound settings before and during a call: microphone and output selection,
  microphone gain, browser echo cancellation/noise suppression/automatic gain,
  overall volume and a local microphone test with a meter and optional monitoring.
  Testing does not join the room, record audio or publish a stream to the server.
- Configurable push-to-talk key, keyboard and pointer hold controls, cancellation
  on pointer loss/blur, typing protection, and a persistent start-muted preference.
  This is browser-focused PTT, not an OS-wide/global hotkey helper.
- Live transport statistics (RTT, jitter, interval packet loss and incoming bitrate),
  reconnect and playback-unlock controls. Missing statistics remain dashes.
  Copied diagnostics exclude participant names, room IDs, addresses and tokens.
- Russian and English text throughout the workspace. Unsupported browser features
  explain their limitations instead of showing a supposedly working control.

The server still authorizes the global/location selector exclusively for the
party leader. Roster search/cards use the authorized snapshot only. Private mode
never falls back to global or mesh voice. A transient snapshot failure hides the
roster but does not intentionally tear down otherwise working audio subscriptions;
media authorization remains the responsibility of the existing SFU policy.

## Microphone and lifecycle changes

`useVoiceRoom` gates a capture **before** publishing it. PTT starts silent; open
microphone mode honors the start-muted preference. Device/processing replacement
is serialized and preserves the current mute/PTT gate, including a mute issued
while `replaceTrack` is pending. A failed server mute request never undoes a local
mute. Joining is serialized, cancelled captures are stopped, and a late successful
server join is explicitly left before another join is allowed. Subscription work
is serialized, pending consumer resumes are retried, old local audio elements and
consumers are released, and autoplay rejection is exposed to the user.

These controls do not add video, screen sharing, recording, transcription, an AI
service or cross-room administrative listening. Output selection depends on the
browser; incoming audio mute deliberately does not mute the player's microphone.
The existing one-voice-peer-per-account-per-campaign rule is unchanged.

## Checks and remaining acceptance

Pure regression tests, requiring Node 22 with TypeScript stripping:

```sh
node --experimental-strip-types --test scripts/test-voice-call-client.mjs
```

The 20 tests cover capture preferences, validation, safe mute/PTT decisions,
statistics deltas/counter resets and diagnostics projection. All 20 passed in the
implementation environment. Transpilation of the nine changed/new TypeScript and
TSX modules found no syntax diagnostics; this is **not** a full semantic typecheck.

An isolated Chromium fixture additionally exercised 58 assertions: pre-join
capture privacy, local preview and late permission cancellation, muted entry,
muting during device replacement, rapid replacements, processing updates, local
volume/mute behavior, configurable PTT/typing/blur/pointer cancellation, room
roster changes, failed refresh/recovery, leader controls, dock lifecycle/focus,
permission rejection/retry, cancelling a pending join and 390/320-pixel layouts.
There were no unhandled browser errors in those fixture scenarios.

Fixture limitations: it used React 18 from the execution environment, synthetic
WebAudio microphone tracks, mocked capture/storage/clipboard/signaling/mediasoup,
and isolated copies of existing preference/audio helpers. It did **not** run the
full Next.js/React 19 application, capture a physical microphone or exchange media
with the real SFU. Fixture screenshots are UI evidence, not a production call.

Before production rollout, run the repository's normal lint/typecheck/build and
regression tests with its locked dependencies. Then use three real browsers:
A/B in one location, C elsewhere; verify old-room audio cutoff after movement,
new-room subscriptions, mode changes, reconnect, mobile resume, real device
replacement and browser-specific output routing. Test legacy mesh separately.
No production rollout or DNS/firewall/SFU configuration change was made here.
