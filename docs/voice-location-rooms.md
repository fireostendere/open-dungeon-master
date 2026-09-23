# Global and private location voice

The campaign voice panel has a server-authorized selector owned by `leadUserId`,
not the DM role. `global` is the backwards-compatible default; `location` uses
`spatialStore().getUserRoom(campaignId, userId)`, never the selected/history tab,
a request-supplied room, a battle token, or a room name.

The existing mediasoup call controls are retained: microphone/device selection,
mute, deafen, push-to-talk, speaking indicators, per-person volume and reconnect.
This is a D&D integration, not a copy of the LiveKit Meet cinema/video/recording
features in `my-voice-chat`. No LiveKit keys, new hostname or second SFU is added.

## Behavior

- Global: members of this campaign share one voice channel.
- Private: only members assigned to the same current spatial room can exchange
  audio or see each other's voice presence. A missing/disabled spatial assignment
  isolates the user rather than placing all missing assignments together.
- The leader chooses the mode but has no cross-room listening exception. The
  legacy omniscient human-DM audio exception is disabled in private mode too.
- Moving closes forbidden server consumers in both directions synchronously on
  the spatial after-commit notification. New subscriptions are established by the
  existing client flow. Mic mute/device settings are not reset for a room move.
- Snapshot, join, consumer descriptors, resume authorization and live roster /
  speaking frames use the same policy. Hidden rooms cannot be listed or selected
  through the legacy manual-breakout API. Old hand-managed breakout controls are
  deliberately replaced by global/location mode.
- One existing voice peer per account per campaign is retained. This work does not
  add simultaneous microphones for one account across multiple tabs/devices.

## Deployment

Private mode requires **enabled SFU voice** and enabled campaign location mode.
Browser-to-browser mesh cannot guarantee server revocation of an established call,
so the private-mode API refuses mesh. The existing admin voice settings select
SFU; configure its announced address and allow the existing RTC port (default
44444 UDP/TCP). Browser microphone access requires HTTPS (localhost excepted).
The selector explains missing prerequisites. It does not edit DNS or deployment.
Legacy mesh join/signaling also reject private scope, including direct API calls.
Existing mesh calls must end before the leader may enable private SFU rooms.
Do not change the server to mesh during a private session.

`voice_chat_scopes` is created lazily and holds one checked mode per campaign,
with an ON DELETE CASCADE campaign foreign key. It is included in SQLite backups.
No secret or media is persisted there. Existing campaigns without a row are global.

## Validation and limitations

Run `node --experimental-strip-types --test scripts/test-voice-location-policy.mjs`.
The pure tests exercise both modes, outsider denial, unassigned users, roster
projection, spoofed channel IDs, synchronous two-way revocation, mode switches,
member removal, idempotency and absence of leader/DM bypasses.

Before production merge, run the full repository tests, TypeScript check and build,
then a real three-browser/media test: A/B together, C elsewhere; move A to C;
confirm B loses A's media and presence; reconnect A in the new room; change modes
as leader; reject non-leader PATCH and forged channel/consumer requests. Also
exercise voice off, SFU misconfiguration, account switching and mobile background /
resume. Pure consumer stubs and syntax checks do not establish real WebRTC audio.

Presence refresh is serialized once a second, independent of the narrator/MCP.
The server closes media on the after-commit movement notification; the UI poll is
not the security boundary. Private events contain only projected identities, but
this implementation does not claim resistance to all traffic-timing side channels.
