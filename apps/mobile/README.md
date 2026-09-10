# OpenBot Mobile

React Native app built with Expo SDK 57, Expo Router, TypeScript 7, Biome, and Bun. The app uses Expo Continuous Native Generation, so native `ios/` and `android/` directories are intentionally not committed.

## Requirements

- Node.js 24 or newer (the repository pins 24 in `.nvmrc`)
- Bun 1.3 or newer
- Expo Go for device testing, including the WebRTC server connection

## Development

The repository uses Bun’s hoisted linker so native Expo modules resolve to one installation.
The root `postinstall` runs `bun run --cwd apps/mobile setup:skia` after dependency installation.
Skia 2.6.2 needs this step to copy its packaged native libraries before CocoaPods runs;
EAS and local installs use the same setup.

Expo Router 57.0.20 is patched in `patches/expo-router@57.0.20.patch` to apply zoom dismissal
bounds when its enabler registers after the chat mounts. This keeps the avatar-to-header zoom
interactive from the left edge without enabling dismissal from the middle of the chat.
The same patch keeps navigation queue snapshots immutable so React observes every navigation
action, including the first tap when reopening a chat after going back.
If a row or pinned avatar is tapped during the native return transition, the app retains that
tap until the list is focused and `transitionEnd` fires. It then invokes the original Link
handler once, preserving its AppleZoom source without a fixed delay.
Focus is read from the route's live `isFocused()` state; nested navigators do not always emit
an initial `focus` event, so a first tap must not depend on receiving one.

Keyboard Controller 1.21.9 is included in SDK 57 Expo Go. Custom development clients and
standalone apps must be rebuilt after adding this native dependency; a JavaScript reload alone
cannot add it to an existing binary. All channels use the fingerprint runtime policy, so these
updates cannot target older app-version `1.0.0` binaries without Keyboard Controller. Build and
distribute a binary with the new fingerprint before publishing compatible OTA updates.

Run commands from the repository root:

```bash
bun run mobile
bun run mobile:ios
bun run mobile:android
```

For an Expo Go device outside the computer's trusted local network context, start Metro with a secure
tunnel:

```bash
bun run mobile -- --tunnel
```

The native UI does not depend on a native WebRTC module. A hidden Expo DOM component owns the browser
`RTCPeerConnection` and its authenticated DataChannels, then forwards validated commands and live
events to React Native. This keeps the production transport identical while remaining testable in
Expo Go without a development build.

Remote connection recovery starts the first attempt immediately, then waits 10 seconds after each failure. After
five failures it waits two minutes before starting a new series. The agent list shows `Reconnecting`
beside the server-list button in the header, with a smaller attempt counter and retry countdown below.
The status disappears once connected. Chat shows a compact, centered `Reconnecting · x/5 · m:ss`
above the composer, with the same animated digits and no banner. The composer and status float over
the message list on a transparent layer; bottom spacing keeps the last message clear of the controls.
The composer and status track interactive keyboard dismissal through `KeyboardStickyView`;
`KeyboardChatScrollView` uses the same native keyboard frames for message insets and scrolling.
There is no additional `KeyboardAvoidingView` or keyboard-event timer in the chat. The status disappears
after reconnecting. Countdown ticks are local UI
updates, not requests. Backgrounding suspends retries. Returning reuses the existing peer and reloads
workspace data silently. A healthy connection stays online and usable during this check; returning
does not show `Reconnecting` or disable sending. These reads use the existing WebRTC connection,
without creating an account session or ticket. The required compatibility read has a three-second deadline; a silent peer is closed
and its first replacement starts immediately. RTC disconnections keep their five-second recovery grace
period. A previous failed connection attempt keeps its retry deadline across app switches. A successful
connection resets the counter. Dead
WebRTC peers are discarded and authenticated again. Recovery reloads cached conversations as well
as agents and unread counts, including after an event-buffer reset. An interruption of Signal alone
can resume sooner while the authenticated WebRTC connection is still healthy, without a new ticket.

Chat links use a local link icon, with a smaller icon in thought-process text. Rendering links
or Markdown images does not contact their destinations; they open only on tap.

The Bloub loading overlay first renders a single idle pose. After commit, the animation provider
prepares one shared 30 fps sequence in idle batches of at most four frames. Hidden loaders and
reduced-motion mode do not start that work. Exit geometry is prepared the same way while holding
the current pose, then settles to idle before scaling down; unfinished preparation is cancelled
when no longer needed.

Working avatars also prepare their sequences in idle batches of at most four frames, sharing
both pending work and cached geometry across presentations. They hold the idle pose until ready;
leaving the screen or ending activity unsubscribes, cancelling preparation when no player needs it.
Returning to idle uses the same bounded scheduler and holds the displayed pose until ready;
resuming activity or unmounting cancels the pending return.

Streaming Markdown reveals words only for messages up to 2,000 characters. Longer responses
show incoming text directly, avoiding a full Markdown parse for every additional word reveal.

Structured question forms appear inline in mobile chat, including when reopening downloaded history.
They support option selection, multiple questions, skipping and cancellation. Custom answers are typed
in the main chat composer and sent to the current form question, rather than posted as chat messages. Responses
use the existing `/v1/prompts/respond` endpoint over the authenticated desktop connection; conversation
updates synchronize their resolution across devices. Offline forms are disabled, failed submissions
can be retried, and completed or expired forms cannot be submitted again. Private answers use a
secure input and are omitted from the local completion summary; unsent drafts stay in component memory.

When no agents have loaded and the selected server is connecting or offline, the agent list shows
`Waiting for connection`. The empty-server prompt appears only once the server is online; agents
already loaded remain visible during reconnection.

While a server is disconnected, its agent avatars and colored chat bubbles fade locally with the same
280 ms transition. Chat input, attachments,
voice/send controls and suggested prompts are disabled. Draft text is preserved, and the controls
and original colors return when the server is online. This visual state is derived only in the
mobile UI: it never changes the agent's synced avatar profile or sends appearance updates over RTC.

Invitations pin the desktop public key before acceptance. Pins are stored in the device Keychain /
Keystore, scoped to the account service and user, and checked on later directory refreshes. Joining
installs the validated host immediately; a subsequent directory-refresh failure does not undo a
successful join or require reusing the one-use invitation.

After Mobile Connect has enabled publishing, restarting the development desktop restores its
WebRTC host as well as its local HTTP API. A local-only `online` status is not enough for mobile
connections. The separate development test client never auto-publishes.

Account validation and the server directory share the same refresh policy, with one controller per
endpoint and account. They refresh when 15 minutes have passed since the last successful response,
including on foreground return. Failed requests retry after one minute while foregrounded. Pending
requests are shared; an invalidation during a request causes one follow-up after success. Background
entry stops timers, and iOS system overlays do not restart them. Ordinary RTC failures do not reload
the directory. Session revocation and membership actions still refresh it. A stored session is shown
while startup validation runs; an invalid credential clears that login, while network failures retain it.

## Source structure

The mobile app uses a feature-first structure. Expo Router files stay deliberately thin: `src/app`
defines URLs, route groups, guards, and navigator options, while screen implementations live with
the feature that owns them.

```text
src/
  app/                  Expo Router routes and layouts only
    (app)/              routes available to an authenticated session
  features/
    auth/               QR sign-in, session storage, and session context
    agents/             agent list, agent actions, and pin transitions
    chat/               chat screen and its focused UI sections
    search/             search model, controls, results, and screen
    servers/            server drawer and joining a server
    settings/           account settings screen
    workspace/          remote directory, WebRTC transport, live events, and workspace state
  shared/
    components/         UI used by more than one feature
    lib/                platform and infrastructure helpers
```

Keep code inside a feature until a second feature needs it. Move it to `shared` only when it has no
feature-specific behavior. Shared code must not import from features; direct feature-to-feature reuse
should stay explicit so it cannot turn into an accidental circular dependency.
Split screens into focused sections when they combine navigation, local state, and multiple distinct
UI regions; for example, chat owns separate header, message-list, and composer components.

## Design development

The mobile design system is documented in [`DESIGN.md`](./DESIGN.md). Read it before implementing or reviewing UI.

In short, use HeroUI Native for application content and reusable product components. Use native Expo Router and `@expo/ui` surfaces for navigation, headers, tabs, toolbars, search, menus, and route-level sheets so each platform owns its chrome and iOS can render Liquid Glass where the operating system supports it.

## Verification

Chat follows the [v0 chat interaction model](https://vercel.com/blog/how-we-built-the-v0-ios-app).
`use-chat-motion.ts` owns measurements, native blank-space insets, initial positioning, and send
animation sequencing. Message groups keep stable keys. Responses fill the blank space without
autoscrolling; the down-arrow returns to the latest content. Keyboard Controller absorbs keyboard
and composer growth into the blank space before shifting content at the end of the chat.

Streaming Markdown uses a bounded reveal pool (four active nodes, batches every 32 ms). It renders
the complete received text without a second typewriter queue. Reduced motion skips movement.
The floating composer uses the existing Expo glass components with an opaque accessibility fallback.
Mobile file attachments are currently disabled by `CHAT_ATTACHMENTS_ENABLED` in
`use-chat-attachments.ts`. The plus button shows a native Coming soon dialog; large pasted text
stays in the input. When enabled, the native menu on the plus button opens Files. The plus button and input share one row; there is
no separate paste button. The native multiline input grows to five lines, then scrolls internally;
its height limit follows the system font scale. Large text pasted into the input becomes a text attachment. Mobile uploads
use the released file-transfer protocol and are limited to 10 MB per file. Sending dismisses the
keyboard. The gesture area covers the chat and uses the measured composer height for dismissal.
The installed Keyboard Controller content-inset hit-test workaround enables scrolling in blank space.

Device verification must cover: first send with the keyboard open/closed; subsequent sends; short
and long responses; initial history position; scrolling up while streaming; down-arrow; multiline
composer growth at the end and in history; interactive keyboard dismissal and swipe-to-focus;
background/foreground; reduced motion/transparency; text/image/file paste; upload failure and retry.
Code blocks show the fence language and a Copy action. They use the same syntax tokenizer as
desktop, render native text, and retain plain text for unknown languages. Highlighting does not
change source whitespace. Copy writes only the source to the system clipboard.
The local model and protocol tests do not establish native animation quality.

```bash
bun run mobile:lint
bun run mobile:typecheck
bun run mobile:doctor
```

## EAS

The project is linked to EAS and has development, preview, and production build profiles in `eas.json`.

```bash
cd apps/mobile
bunx eas-cli@latest build --profile development --platform ios
bunx eas-cli@latest build --profile development --platform android
```

Cloud builds require the final `ios.bundleIdentifier` and `android.package` values in `app.json`. Store submission also requires Apple Developer and Google Play Console credentials.

## OpenPanel product analytics

The app uses the official [`@openpanel/react-native` SDK](https://openpanel.dev/docs/sdks/react-native)
and `expo-application`, following the [React Native guide](https://openpanel.dev/guides/react-native-analytics).
The endpoint is fixed to `https://analytics.openbot.run/api`. No analytics credentials are committed.

### Production configuration

1. In the self-hosted OpenPanel dashboard, open the same project used by desktop and the website.
   Create a separate client for OpenBot Mobile with **write** access only. Copy its Client ID and
   Client Secret. Do not use an organization/root client or a client with read access.
2. In the Expo dashboard, open the **openbot** project → **Environment variables**, select the
   **production** environment, and add:

   | Variable | Value |
   | --- | --- |
   | `EXPO_PUBLIC_OPENPANEL_CLIENT_ID` | The mobile client's Client ID |
   | `EXPO_PUBLIC_OPENPANEL_CLIENT_SECRET` | The mobile client's write-only Client Secret |
   | `EXPO_PUBLIC_APP_ENV` | `production` |

   The production build profile also sets `EXPO_PUBLIC_APP_ENV=production`. Development and preview
   profiles set their own environment and never send events. Set the variable in the EAS environment
   too, so production OTA updates use the same gate. Keep the credentials out of development/preview.
3. Generate the next production native build through the usual approved release process. The new
   `expo-application` native dependency requires a new binary; do not send this change as an OTA
   update to a binary that lacks it. Build and deployment are separate operations, not part of setup.
4. In that build, leave **Settings → General → Privacy → Share product analytics** enabled.
   OpenPanel's Real-time view should show `mobile_app_opened` with `surface=mobile`. Pair the phone,
   open a conversation and send a message. Confirm connection and message events, then disable the
   setting and confirm that new actions do not send events. Repeat on iOS and Android.

React Native requires a Client Secret according to OpenPanel's native SDK guide. In this direct
native integration it is an **embedded write credential**, not a confidential server secret.
Expo's `EXPO_PUBLIC_` values are visible in the shipped bundle. Use only a dedicated write client;
never embed a key for Export, Insights, Manage, or an OpenBot account/session. EAS visibility can hide
values in its UI but does not hide them in the app. See [OpenPanel client access levels](https://openpanel.dev/docs/api/authentication)
and [Expo environment variables](https://docs.expo.dev/guides/environment-variables/).

For a local production configuration, put the same variables in the ignored
`apps/mobile/.env.local`. Ordinary development mode still disables analytics. A missing Client ID,
missing Client Secret, non-production environment, or web runtime disables the client without
blocking the app. Tests replace native modules and the HTTP transport; they do not contact OpenPanel.

SDK 1.4.1 declares old peer ranges (`expo-application` 5–7 and `expo-constants` 14–18).
Expo SDK 57 uses the SDK number for these package versions. Keep the Expo-compatible versions
installed by `expo install`; do not downgrade them to silence that peer warning. Native verification
of both platforms is required before release.

### Event catalog

Every event has `surface=mobile`, `platform=ios|android`, `environment=production`,
`event_schema_version=1`, `app_version` and `build_number`. Operation outcomes use `result` and,
where available, `duration_ms`. Failure codes are fixed categories, never raw error text.

| Event | Meaning |
| --- | --- |
| `mobile_app_opened` | Cold start or return from background, with `signed_in`; iOS inactive overlays do not count as a new visit |
| `mobile_pairing_action` | Sign-in scanner opened, camera permission result, QR redemption result, scanner cancelled |
| `mobile_connection_action` | Initial connection attempt, reconnection attempt, or connection lost; result, duration and bounded loading stage |
| `conversation_opened` | One visible-visit outcome and time to readable conversation, including cached/offline reads; failures when no readable conversation is available |
| `message_send` | Host receipt or failure, attachment count, reply flag, provider/model/reasoning metadata when known |
| `agent_input_action` | Submission of a structured prompt answer; no answer contents |
| `attachment_action` | Local file selection, upload, removal; result, count and coarse size bucket when known |
| `agent_action` | Create, update, duplicate or delete |
| `routine_action` | Create, update or delete, including enabling/disabling through update |
| `memory_action` | Create, update or delete |
| `search_action` | One summary when a search screen closes after using a query/filter; final result count, no query |
| `team_action` | Select, join or leave a server |
| `conversation_action` | Pin/unpin or hide/unhide, including preference-save failures |
| `usage_viewed` | Open the agent Usage section |
| `account_sign_out` | Sign-out result under the initiating account |

Use a mobile activation funnel from open → successful QR redemption → successful connection →
conversation load or message send. Measure signed-in D1/D7 retention by OpenBot account ID. Anonymous
pairing events precede identity, so do not interpret account-only funnels as the full pairing funnel.
A message receipt means the host accepted the message, not that the agent finished its work.
Connection retries are separate attempts; countdown ticks and background suspension are not failures.

The app does not emit host `system_turn_*` events again. Host lifecycle remains attributed to the
host owner and does not identify which client started the work. Analytics does not change Team API.

The local phone-wide preference is loaded before SDK creation. If it cannot be read, collection
stays off. Opt-out clears pending events and blocks later sends; it cannot retract a request already
sent. Account changes reset identity in order, and late results from an old account are discarded.
There is no persistent offline analytics queue. Transport failures can lose events, and collection
never blocks product actions. Session replay, automatic screen capture, route IDs, QR values, tokens,
file names, contents, URLs and raw errors are excluded. The SDK's Android referrer and path metadata
are removed again at the final send filter. Account ID and normalized email identify the profile;
email is not an event property. The phone preference is independent of desktop/host analytics.
