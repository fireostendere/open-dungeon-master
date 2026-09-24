# Reading-first mobile table

The mobile transcript is the main surface, not the space left over after every control has expanded. This change is scoped to the active campaign screen; the lobby and server/game APIs are unchanged.

## Interaction

Below 1024 CSS pixels the header is a single row. The title truncates, while Table tools reveals the full title, scene, dice animation, ambience volume, help, language and account controls. VoiceDock remains a singleton outside the responsive tool branch.

The composer has a native message-mode selector, a compact status/turn-controls disclosure, a reader-mode button and a one-line input. The input grows to at most 144 pixels, further bounded on short viewports. Phone Return inserts a newline; the send button or Control/Command+Enter sends. Desktop Enter still sends. Composition events never submit unfinished IME text.

When the server-derived input gate is closed, the disabled input row is hidden on mobile. The mode selector remains reachable: Ask DM and OOC can be chosen under the existing permissions. Details explain the full lock reason. An existing draft is retained, not cleared.

Turn details open over the transcript as a bounded, non-modal disclosure. Pending rolls, skip controls, floor release, story/join notices and combat navigation live there. Its contents are always mounted: closing it does not discard entered dice faces or unsubscribe physical dice. Outside pointer presses, Escape and the close button dismiss it. Entered pending-roll fields cannot block the independent message form's browser constraint validation; each action retains its existing server validation.

The bottom row contains Table, Party, Battle and Chat where permitted, then More. More contains the remaining **already-filtered** panel definitions, preserves unread/approval indicators and shows the selected overflow destination. There is no horizontal hunt for another tab. The original game-driven panel selection rules are preserved.

Reader mode hides header, composer and bottom navigation with CSS, not React unmounting. A floating Back to game button restores them and the prior focus/scroll position where applicable. A game-driven jump to another panel exits reader mode. The transcript has bottom clearance for the return button.

## Viewport and accessibility

`SessionViewport` follows VisualViewport height/offset only on mobile and at normal zoom. Editable focus plus a height loss above 120 pixels identifies a likely software keyboard; focus alone and pinch zoom do not. Header/navigation disappear while that keyboard is open. Safe-area insets are respected. Listeners, animation frames and document CSS variables are cleaned up on unmount.

New navigation and primary input controls have at least 44-pixel touch targets. Input fonts are 16 pixels on mobile, focus outlines remain visible, status announcements exclude ticking countdowns, and reduced-motion preferences are honored. Nested account/language poppers are explicitly layered above the open tools sheet.

The disclosure's space is measured from the actual column and composer positions, including secondary notices and a growing textarea. ResizeObserver tracks the composer, column and transcript rather than assuming a phone height.

## Verification performed

`node scripts/test-mobile-session.mjs` passes. The standard `scripts/test-all.mjs` discovers it automatically. It exercises keyboard-versus-zoom detection, textarea bounds, Enter/IME behavior, all 1,024 subsets of the ten permitted tab IDs, TS/TSX syntax and singleton/persistent-mount contracts.

An isolated Chromium layout harness evaluated the changed TSX with inert external widgets, applied Tailwind 4 and the actual new stylesheet, and passed 47 viewport/state combinations. It covered 320×568, 360×740, 390×844, 430×932, 768×1024, 844×390 landscape, 320×480, and desktop 1024×768 / 1440×900. Scenarios included open/locked/combat/pending-roll input, Ask mode, long drafts, synthetic 340-pixel keyboard viewports, CSS reader mode, draft/face retention, disclosure clipping and navigation target sizes.

Representative isolated-layout measurements (CSS viewport, excluding browser chrome):

| Viewport | State | Transcript height | Share of viewport |
| --- | --- | ---: | ---: |
| 390×844 | Normal / combat / pending rolls, details closed | 624 px | 73.9% |
| 390×844 | Locked action input | 678 px | 80.3% |
| 320×568 | Normal input | 348 px | 61.3% |
| 320×568 | Locked action input | 402 px | 70.8% |
| 390×844 | Reader mode | 844 px | 100% before floating return control |

These are **layout-harness measurements, not a production benchmark or a hydrated Next.js E2E result**. Full dependency installation / `next build`, the entire pre-existing test suite, real Android/iOS software keyboards, real WebRTC/Pixels hardware and production deployment were not validated in this environment. Backend room/privacy rules were not altered; this is primarily the legacy transcript composer shown in the reported screenshot, plus the shared session shell/navigation.

## Release smoke test

On the deployed application, check a real player's 360–430-pixel screen with a long campaign title: normal action, a held combat turn, Ask DM/OOC while held, a private question, a lead direction, a manual/Pixels roll, skip/cancel, and all More destinations. Keep a call active while opening tools, rotating and entering/leaving reader mode. Type a multiline draft with Android and iOS keyboards and verify send remains reachable. Also check a DM/lead account and the location-chat view, and run the normal build/test pipeline. No hostname, reverse proxy or server-side narrator change is required.
