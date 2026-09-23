# Web client delivery

The browser client is available to all accounts. The MVP includes shared chat UI,
email sign-in, host connection, files, supported agent actions, and remote browser viewing.
The user deferred the cross-browser matrix on 2026-09-21. CI remains required before merge.
No deployment or pull request is made by these source changes.

## Shared application UI

The browser uses the existing `AccountLogin`, `ServerRail`, `Sidebar`, `AccountDock`,
`Conversation`, `AgentSettingsPanel`, and `FirstAgentSetup` components. After sign-in it
connects to the first available host and selects a teammate. There is no web dashboard,
welcome screen, separate conversation toolbar, or always-visible invitation form.
Invitations use the existing Add remote server dialog.

The conversation accepts an explicit `ConversationRuntime`. Desktop calls still use preload;
the web adapter uses the authenticated host connection. Browser drafts remain in memory.
Native-only actions are hidden. Remote browser transport uses the shared desktop browser
panel through an explicit runtime. Small screens switch between the existing conversation
and workspace panes. Desktop layout remains unchanged. Browser ownership and stream recovery
still require the release checks below.

## Review scopes

Review and ship in this order. PRs 1–4 form the first usable release.

| PR | Scope | Main owners |
| --- | --- | --- |
| 1 | Browser entry, shared shell, typed runtime boundary, preview | `apps/auth-api/src/routes/app*`, renderer `web-client`, shared sidebar, approval and preview components |
| 2 | Email code, cookie sessions, closed account endpoints, CSRF and revocation | `apps/auth-api/src/server/browser-api.ts`, browser API route, remote session binding |
| 3 | Directory cookie mode, host trust, invitations, connection and setup states | `packages/team-client/src/remote-directory.ts`, renderer `web-runtime.ts`, Web Lock |
| 4 | History, live updates, text, stop, questions, approvals, draft recovery | `web-client-context.tsx`, `WebWorkspace.tsx` |
| 5 | Files, cancellation, shared previews, search, pin/hide and reverse actions | Shared file sender, web runtime, shared file panel, search component |
| 6 | Creation, name/description/model settings and notification controls | `WebAgentSettings.tsx`, existing host API permissions |
| 7 | Shared-shell small-screen navigation and browser-panel integration | Web stylesheet, shared `BrowserLiveView`, team-client browser-view adapter and stream codec |

The browser composes existing SolidJS controls; it does not install a fake preload API in
production. Shared conversation controls already receive typed data and action callbacks.
The desktop composition continues to use preload and the desktop preview uses its existing
mock. The separate web preview implements the browser runtime with that same mock data.

## Behavior and limits

- `/api/browser/*` exposes only email start/verify, session read/logout, host list, session
  start/ticket/end, and invitation preview/accept. It is not a general account or host proxy.
- Sign-in credentials are cookie-only. The browser receives a short connection ticket for the
  existing Signal handshake. Session creation, ticket issue and end are bound to its credential.
- The production website accepts invitation links for `https://api.openbot.run`; the request still
  goes to its own origin. Other services are refused. Host fingerprints are checked before use.
- One tab can connect to a given host with an account. Other accounts and hosts have separate
  locks. A second tab gets an explicit message instead of replacing the first tab's peer.
- Capability checks hide unavailable browser-view and creation-model controls. Hosts without
  pagination use their full conversation endpoint. Unsupported media and EML uploads are refused
  before transfer. Host authorization remains the final decision for every action.
- Teammate creation and editing follow the host's existing member permissions. This client does
  not offer host administration, provider installation, or provider sign-in. Agent deletion uses
  the shared confirmation and is hidden for members; the host also enforces the role restriction.
- Uploads and downloads retain the shared client's 10 MB limit. Message attachment count uses the
  shared contract limit. Cancelling a transfer sends the existing file-cancel frame. If the host
  has already committed an attachment, cancellation removes that draft after the response.
- Attachment previews use downloaded bytes and the shared preview panel. Host filesystem paths
  and host preview URLs are not used as browser attachment links. Blob URLs are released when the
  preview closes, the host changes, or the workspace unmounts.
- Pin/unpin preferences are in-memory and specific to the selected host. They do
  not delete conversations. Notification changes use the host's existing settings and include
  mute and unmute. Search queries are not persisted. The separate hide/show toolbar was removed.
- Reconnect reads authoritative state. It never resends uncertain messages. A user must check
  the conversation and acknowledge the uncertain result. New-agent requests with an unknown
  result require closing the form and refreshing before another attempt.
- The browser-view transport uses the existing host stream and input protocol. The shared
  panel is available only when the host advertises browser control and browser view.
- No full remote desktop, push notifications, or offline operation is included. See
  [Remote desktop](#remote-desktop) for the reason.

## Remote desktop

The Moonlight Web viewer already runs as browser code: it uses WebRTC and WebCodecs, with the
host's TURN servers. Only its loading and its signaling socket depend on Electron. On desktop,
`RemoteViewerProxy` serves the viewer from a local origin and sends its HTTP requests and
signaling socket over the host connection.

The browser has no such proxy. The viewer is code from the host, so it must not run in the web
app origin: there it could use the account cookie and read the web app page. An opaque sandboxed
iframe is not sufficient. The viewer reads `location` to find its session and signaling path, it
loads about 100 relative ES modules, and it starts a module Worker from `import.meta.url`.
A Service Worker cannot control an opaque iframe. To serve the viewer there, the client would
have to rewrite and bundle the host's code.

A possible design uses a separate viewer origin, for example `viewer.openbot.run`, on the same
Worker. That origin serves only a trusted bootstrap page and a Service Worker. The Service Worker
sends viewer requests to the web app. The web app sends them over the host connection, limited
to one remote-screen session. On 2026-09-23 the user decided not to add this origin for the MVP.

## Local checks

Run `bun install --frozen-lockfile` in a fresh worktree. Start the API with
`bun run dev:api --isolated`. The supervisor chooses and prints the port.
For synthetic local email checks, `AUTH_EXPOSE_DEVELOPMENT_CODE=true` returns development codes;
do not enable it in production or print codes and cookies in logs. Keep the cookie's security
attributes in development. A browser that refuses secure loopback cookies needs a local HTTPS
origin.

Use `bun run storybook --no-open` for **Web/Workspace/Connected**. It uses the same desktop mock
for messages, models, settings and events. File previews use a small synthetic text fixture;
file transport and browser streaming still need real-host checks. The existing `/app-preview`
and desktop stories remain the comparison surfaces. Do not commit screenshot assets.

Run one focused file at a time:

```sh
bun run --cwd apps/auth-api test:server -- test/browser-api.test.ts --maxWorkers=1
bun run --cwd apps/auth-api test:server -- test/remote-control-plane.test.ts --maxWorkers=1
bun run test:desktop -- src/renderer/src/features/web-client/WebApp.test.tsx --maxWorkers=1
bun run test:desktop -- src/renderer/src/features/web-client/WebWorkspace.test.tsx --maxWorkers=1
bun run test:desktop -- src/renderer/src/features/web-client/web-runtime.dom.test.ts --maxWorkers=1
bun run test:desktop -- src/renderer/src/features/web-client/web-host-lock.dom.test.ts --maxWorkers=1
bun run test:desktop -- packages/team-client/src/remote-directory.test.ts --maxWorkers=1
bun run test:desktop -- packages/team-client/src/remote-peer.test.ts --maxWorkers=1
bun run test:desktop -- packages/team-client/src/file-upload.test.ts --maxWorkers=1
bun run test:desktop -- packages/team-client/src/browser-view.test.ts --maxWorkers=1
```

Lint changed files only. CI owns broad type checks, builds, UI checks and full suites. Shared
team-client changes also affect mobile; its bearer authentication and existing peer tests must
remain green. Main-process stream imports use a compatibility re-export. Signal and database
schemas are unchanged.

## Release gate

Local API checks cover email start/verify, cookie session restore, host listing, cross-origin
logout refusal, logout, and revoked-cookie refusal. Browser preview checks cover shell rendering,
text send/reply, settings and file preview.

An isolated `bun run dev --isolated` host was also checked with the in-app browser. Email
sign-in, host discovery, the WebRTC connection, teammate/history loading, a live message and
provider reply, and a JSON file transfer into the shared preview panel passed. The sent message
also appeared in the desktop app. This is a focused local check, not the complete release gate.
When the local account service returns a development code, the web sign-in form displays it,
as the desktop form does. Production must not enable `AUTH_EXPOSE_DEVELOPMENT_CODE`.

Before enabling the deployed flag:

- Complete CI and compare desktop and browser screenshots for each UI review scope.
- Check email sign-in after browser restart, sign-out and revocation across tabs, and the
  single-host tab lock. The Chrome, Edge, Firefox and Safari matrix is deferred by the user.
- Check invitation expiry, revocation, prior use and wrong-account errors; no-host guidance;
  offline and incompatible hosts; host key mismatch; host switching; and reconnection.
- Check history pagination, live output, uncertain sends, stop, approvals, answered/expired
  prompts and subscription cleanup against the host.
- Check file bytes, previews, limits, cancellation during transfer, interrupted downloads,
  creation/settings permissions, older-host capability gates and takeover ownership/release.
- Confirm that disabling the flag rejects new sign-ins, sessions and tickets while logout works.

No cross-browser or real-host release approval is recorded by this implementation task.

### Local web verification — 2026-09-21

The in-app browser reached the isolated development host at `http://localhost:3101/app`.
The synthetic account used a separate loopback origin from the user's signed-in browser tab.
The following checks passed against the running host:

- Login background and form readability; rejection of an incorrect code; successful full-code
  paste retry; session restore and host reconnection after page reload.
- Text entry, send and live reply; agent question selection and completed answer; stopping a turn.
- Draft retention across teammate selection; conversation search and next-result navigation.
- JSON preview; a real text-file upload, message attachment, and preview of its exact contents.
- Cancellation of an 8.1 MB text-file upload, with no resulting composer attachment.
- Logout cleared both synthetic-account tabs without changing the user's separate account session.

The run found and fixed full-code paste starting at the selected OTP slot, expired prompt state
remaining active, and host locks surviving failed connection setup. Upload cancellation is now
attempted before reconnect and disconnect. Focused OTP, workspace, and runtime tests cover these
changes. The shared editor's disabled-key handling was covered in the preceding regression run.

Download was invoked, but the browser tool did not report a download event; saved-file integrity
is not verified. Approval decisions, two-host switching, interrupted connection recovery, older
host interoperability, invitation edge cases, and the four-browser matrix remain open. Search
navigation passed against seeded history; loading an unloaded result has focused test coverage,
not a separate live large-history check. No public release or merge approval follows from
these local checks.

The follow-up run checked the shared phone shell at 390 × 844 pixels. Chat/workspace switching,
teammate selection, the settings panel, and notification mute/unmute passed against the host.
An account-dock overlap with bottom navigation was found and fixed. An invalid invitation
link was rejected in the shared dialog. A test teammate was created through the shared form,
appeared in the sidebar, and returned its initial response. The shared browser panel displayed
live frames of the local landing page opened by the host. Pointer mapping through portrait
letterboxing was fixed; clicking the host page's App link then opened its login page.
A printable key entered text in the host form without submitting it.
A host takeover request appeared in
chat, and selecting “I’m done” completed it and resumed the agent. End/PageDown behavior, competing
takeover ownership, and ownership release after disconnect remain unverified.
Agent creation model capability and stale-response behavior have focused
test coverage. Live development code
updates can leave a host-lock error until page reload; normal page reload reconnected.

The follow-up focused checks passed: workspace (13), agent creation (3), web login (4),
desktop browser composition (45), web runtime (12), and live-view pointer mapping (1).
Changed-file Biome and `git diff --check` passed. The desktop browser tests emit the existing
jsdom canvas warning. Broad type checks, builds, and the full suites remain for CI.

If an attachment request reached the host before connection teardown, an unreferenced draft may
remain there: the released protocol cannot cancel a committed HTTP request. Cancellation before
teardown reduces this race but does not guarantee removal of an already committed remote draft.

### Post-main verification — 2026-09-21

After updating to main `735bcb3f`, the existing isolated dev stack was checked again. The in-app
browser used `http://localhost:3101/app` and a synthetic account. Live message send/reply,
conversation draft retention, the second-tab host lock, sign-out clearing both test tabs,
email sign-in, session restore, and host reconnection after page reload passed. An existing
uploaded text attachment rendered its expected contents through the shared preview panel.
No browser console errors appeared in these checks. A development reload allowed the second
test tab to acquire the host lock; leaving that tab and reloading restored the first connection.

Desktop automation checked the matching worktree instance. The shared shell, composer input,
and General, Computer Use, Profile, Mobile Connect, and Updates settings rendered. Existing
reactive cleanup and focus warnings appeared; no runtime error was observed. No provider
installation, sign-in, update, or account disconnect action was attempted.

The follow-up review found two gaps: failed approval actions could remain busy, and downloaded
files had no browser size limit. The shared approval card now reports failure and permits retry.
The web runtime rejects downloads larger than 10 MB before creating the file Blob. Focused
checks cover these cases, including the exact download limit and unchanged small-file bytes.
The account API, remote session service, workspace state, file sender, and browser-view adapter
focused tests also passed. Dev remains running; no public flag or deployment was changed.

This run does not close the release gate. Live approval failure/retry, saved-download byte
integrity, two-host switching, competing browser ownership and release on disconnect, older
hosts, and the Chrome/Edge/Firefox/Safari matrix still need verification. The current local
setup supplies one development host and the in-app browser. CI must run the broad checks.

### Download and takeover follow-up — 2026-09-21

The browser saved `web-transfer-smoke.txt` to Downloads. Its 76 bytes exactly matched the
synthetic upload fixture, including line endings. SHA-256:
`622d4809e80e2a16dc269b4518aa3616c8e5bb59ee6f9080e79b2963238db572`.
This closes saved-file integrity for that fixture, not interrupted or large-file transfers.

A real browser takeover request appeared in both the web UI and the matching isolated desktop
app. Cancelling it from web cleared the request in both clients and resumed the agent, which
confirmed cancellation. Desktop returned to its normal composer. This does not establish competing input ownership or disconnect release.
The focused host browser-view gateway test passed all four cases: frames/pointer scaling,
authorization, session invalidation, and socket cleanup.

The harmless shell command used to seek an approval completed without asking for approval;
it therefore provides no live approval decision or failure/retry evidence. Chrome testing was
not started because Chrome was not running; launch permission was requested. The remaining
release checks above still apply, except saved-byte integrity for the named fixture.


### Shared sidebar and usage parity

The browser now passes the host's `sidebar-layout` snapshot and mutation action to the existing
shared Sidebar. This enables its native drag controls, section menus, and grouping without a
second web implementation. Layout changes remain on the host and follow its capability gate;
older hosts keep a read-only default layout. Late responses from a previous host, and lower
layout revisions after a newer event, cannot replace the current layout. Pin order and collapsed
sections remain in browser memory and clear with host state.

The existing shared AccountDock now shows its usage indicator and provider popover in the web
client. Usage comes from the existing host Team API, with the same contract validation, refresh
controls, and visual components as desktop. Switching hosts clears usage and rejects stale UI
updates. The web preview uses the desktop mock for usage and sidebar layout too.

Local checks covered provider usage display/refresh, drag-to-pin/unpin, creating a section and
assigning an agent, saved assignment after reload, collapse/expand, and deleting the temporary
section without deleting its agent. Native dragging between sections was attempted but no
move was observed through the browser harness; the shared desktop drag implementation is
unchanged. Channels, people, and desktop-only settings remain outside the implemented web controls.


### Agent action parity

The browser uses the shared Sidebar context menu and delete confirmation for duplicate/delete.
Duplication requires the existing host capability. Its operation ID remains stable when a response
is uncertain, so an explicit retry can use the host's existing idempotency contract. No automatic
retry is made. Deletion refreshes host state and removes the deleted agent's local draft and pins.
The same desktop activity and avatar-state functions now consume loaded web conversation state
and pending prompts/approvals; unloaded conversations do not invent activity or unread counts.

A live check duplicated only the synthetic Web Smoke agent, selected its one new copy, cancelled
the first delete dialog, and then deleted that temporary copy through the shared confirmation.
The original remained and became selected again. No browser runtime errors were observed.
No new UI components, host protocol, database migration, or native mobile changes were needed.

### MVP safety and first use — 2026-09-21

Accounts without hosts now receive setup instructions, a desktop download link, refresh, and
the existing invitation dialog inside the conversation pane. Directory failures can be retried.
Accepted single-use invitations can retry host connection without consuming the invitation again,
including when the browser was already connected to another host.

A confirmed send stays confirmed if the following history read fails. An uncertain send keeps
the draft and requires explicit user review; it is never sent again automatically. Revocation
clears private conversation state immediately, even while the directory request is pending.
Controller drafts clear on revocation or host switching, but remain through temporary reconnects.

Browser-view sessions close before explicit peer teardown. Completed attachment draft IDs are
tracked per host and discarded before switching or ending access. Sent attachments are not
deleted. Same-host reconnects preserve drafts. Cleanup is best effort if the host is unavailable. Failed explicit cleanup is retried after a successful connection to that same host.
The released API cannot recover an upload whose host commit succeeded but whose response,
including the attachment ID, was lost; host draft cleanup remains responsible for those files.

Focused checks passed: workspace 25 tests, account UI 6 tests, runtime 23 tests, and changed-file
Biome checks. The live in-app browser check covered a new account with no hosts, refresh, invalid
invitation feedback, logout, sign-in to the development host, and opening/closing the existing
remote browser view. No browser console errors were observed in that run.

Full remote desktop is deferred (see [Remote desktop](#remote-desktop)). Remote browser viewing and takeover use the existing host API.
The earlier live-test gaps remain documented above; focused tests do not establish full live
two-host or competing-owner coverage. Broad checks remain assigned to CI. Development remains
running, and the public release flag has not been enabled.

### PR verification follow-up — 2026-09-21

CI passed on `50bfa658`, including Check, API, both desktop shards, browser smoke,
Storybook, Cloudflare preview, remote, hosted sites, and Surfaces. NorbiAI reached its
15-minute timeout without a review result. That timeout is not a code finding or a
successful review. The PR remains open and must not be merged by this task.

The live browser disconnect check found a host session leak: an abruptly closed stream
still occupied a browser-view slot. The gateway now removes the detached session. Its
five focused tests pass, and five consecutive page unload/reconnect cycles each reopened
the real host browser view without exhausting the session limit.

Two isolated hosts were connected to the same local account and Signal services. The
browser switched between them, sent a message to the second host, received its reply,
and restored the correct history on each return. The second host's reply did not appear
in the first host's conversation. Unsent text cleared on host switching and did not cross
between hosts. No browser console errors appeared. A secondary local host must allow the
same Signal URL in its Electron CSP that the shared account service returns in tickets.

The approval follow-up found that interrupted turns removed prompts but left approvals
in web state. The web controller now removes approvals for the completed agent, thread,
and turn, as desktop does. The focused workspace suite passes 26 tests, including removal
of an interrupted approval while other turns' and agents' approvals remain.

Live approval failure/retry is still unverified: harmless commands produced no manual
approval card, including after automatic approval was disabled for the temporary test
agent. That agent was removed through the shared confirmation. Earlier focused approval
failure/retry tests remain the evidence for that path. Separate-account competing takeover
ownership is also unverified; the live run checked same-account tab locking and browser
stream recovery. Release-switch checks and the cross-browser matrix remain deferred.
