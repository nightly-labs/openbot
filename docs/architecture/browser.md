# Browser

## Browser client

`apps/auth-api` serves `/app`. Its lazy route mounts the interactive client after browser startup.
`src/renderer/src/features/web-client` owns the browser composition and its typed
`WebWorkspaceRuntime` interface. It mounts the existing account login, server rail, sidebar,
account dock, and full conversation view. `ConversationRuntime` routes host actions through
the browser connection; its desktop default is the preload API. The desktop `WorkspaceShell` and the
web client draw the same `WorkspaceFrame` under `LayoutProvider`, so the rail geometry, the sidebar
resizer and compact modes, the compatibility screen, and the usage report slot are the same on both.
The overlays that both clients raise - join, marketplace, shared agent, server settings, global
search and channel creation - are prop-driven views in `WorkspaceOverlayViews.tsx`.
`WorkspaceOverlays` fills them from the desktop contexts, and the web client fills them from its
host connection, so what an overlay decides from its server is decided in one place.
The web client gives `PlatformProvider` a fixed `appInfo` in place of the main-process answer.
There is no separate web dashboard.
Small screens switch between the same conversation and workspace components. The shared browser
panel receives the web live-view runtime and hides unsupported native controls. `BrowserLiveView`
accepts an explicit runtime; desktop and the existing preview still default to the preload-compatible
API. The web Storybook runtime uses
`preview/mock-openbot.ts` through `preview/mock-web-runtime.ts`.

The browser runtime uses `packages/team-client` for the directory, authenticated WebRTC peer,
Signal recovery, file transfers, and browser-view streams. The stream codec lives in contracts;
the old main-process import re-exports that codec without changing its wire format. Account
requests use a closed list of `/api/browser/*` operations. They cannot carry chat requests.
Browser tickets and session termination require the same account-session hash that created the
remote session. Existing bearer-token endpoints retain their behavior. The browser edits the
account's name, avatar, and sessions through `v1/me/profile`, `v1/me/avatar`, and `v1/me/sessions`,
which call the same `AuthService` methods and avatar storage (`avatar-storage.ts`) as the bearer
routes. The avatar upload is the one write that is not JSON; the origin and `X-OpenBot-Browser`
checks still apply. `web-account.ts` makes these calls, and the shared `AccountProfilePanel` shows
them in the conversation's right panel.

An owner or admin gets the host controls of a desktop remote admin. Shared components keep their
desktop port as the default and take injected calls: `web-server-settings.ts` gives
`ServerSettingsModal` the host identity, MCP, and storage routes through
`@openbot/team-client/team-admin-requests`, and member and invitation calls through the closed
`/api/browser/*` list. The Worker applies the same `RemoteControlPlane` role checks as the bearer
routes. A member or role change revokes every session on the host; the browser reconnects once when
the directory still lists the host. `ConversationRuntime.admin` carries the skills and shared-table
calls to the agent settings panel, which shows only Skills and Tables in the browser. Memories,
routines, and files stay on the desktop. The auto-approve switch writes through the agent-admin
route. `web-marketplace.ts` gives `MarketplaceModal` its calls: the public catalog routes of
the account service that serves `/app` (`@openbot/team-client/marketplace-catalog`), and installs on
the host over `skills-admin-v1`, `agent-install-v1`, `agent-update-v1`, and `mcp-servers-v1`. Try skill and a plugin
prompt add a line to the agent's draft, as on desktop. A shared agent page also links
`/app?agent=<id>`: `WebApp` reads the id once, removes the query, and keeps it through sign-in;
`AgentTemplateInstall` then shows the preview, and the host adds the agent over `agent-install-v1`.
A browser submits nothing to the marketplace. It can publish a host agent's share link over
`agent-publish-v1`, in `ConversationRuntime.admin.agentTemplates`: the host builds the template,
checks it for secrets and publishes it with the account signed in on the host; the browser draws only
the share card from the preview. An agent that the host added from a
listing gets Update when the host serves `agent-update-v1`; the host downloads the current version.
`web-provider-admin.ts` answers the desktop `providerAdmin` group over the `providers-v1` routes, so
the Providers section of `ServerSettingsModal` uses the same runtime, key, custom provider, and code
sign-in logic (`provider-code-login.ts`, `ProviderSettingsSection.tsx`) as the desktop app. On
desktop the section shows the providers of the active server only, because provider state exists
only for that server; for another server it offers to switch. The
browser applies host `status` events, and reads the status every 3 seconds while a code sign-in waits.
A provider key stays in the dialog input until it is sent to the host.

Browser sign-in, account reads, and connection tickets are always available. No host or D1
migration is needed. See [web client delivery](../web-client.md) for the seven review scopes, local
commands, and release checks.

Browser chat pages, drafts, file bytes, and chat visibility preferences stay in memory. A protected
cookie holds the account credential. Local storage holds account-scoped trusted host public keys,
the shared file panel's width, and for each account and host the pinned item ids, collapsed section
ids and selected channel id, not chat content. The channel UI takes a `ChannelsPort` runtime; its
desktop default is the preload API. A Web Lock permits one live tab per account
and host because the existing control plane reuses that credential's logical host session.
Host switches discard the prior host's chat state. Temporary connection loss keeps drafts; a
failed send stays in the chat and is never sent again on its own. BroadcastChannel, account
checks on focus, and signed session invalidation clear access when a session ends.

MP3 and MOV attachments use the existing file attachment contract with no inline preview. Import
copies and hashes the original bytes under the shared attachment limits; it does not run media
codecs or extract frames or transcripts. MIME types come from the file extension for these formats,
so a supplied image or text MIME type cannot enable a preview. Remote support is additive through
the `media-attachments` capability; released protocol adapters keep their existing meanings.

## Browser tool execution

`browser-tools.ts` defines provider schemas and parses each call into a typed tool and its arguments.
`browser-tool-actions.ts` maps input tools to CDP operations. It does not own tabs or import the host.
`BrowserHost` owns tab access checks, operation queues, focus, deadlines, and persistent browser state.
Website popups are adopted into managed `WebContentsView` tabs through Electron's window creation
hook. Native guests retain their opener, request body, and shared browser session. Local tab and
agent tool results expose `openerTabId` while that relationship is live. Independent `noopener`
tabs survive parent closure; dependent popups close with the parent. Closing a popup returns to its
opener. Saved popup URLs omit OAuth callback credentials. Popup state is not restored as a live
JavaScript relationship after an app restart.
Connected pages in a native opener group can retain references to each other's documents, including
a document that received a secret. The browser blocks that access between sites, so a secure input
card is available in a connected tab only when no frame in another live connected tab has the
secret's site. The host checks this when the card opens and again before the fill; otherwise the tab
requires human takeover. The site check uses the last two host labels, which can refuse two sites
under one public suffix but cannot allow one site. Independent tabs remain eligible for secure input. Account selection without secret entry remains automated.
Agents use `list_tabs` after sign-in actions and inspect the new tab before continuing. Secure input
and takeover still handle passwords, codes, CAPTCHA, and passkeys. Blocked requests produce a
reason without including authentication URLs or request data.
Agent instructions keep the viewport stable during sign-in and require fresh targets after page
changes or covered-target errors. X Google sign-in starts on the landing page after cookie consent.
X can retain a Google callback for a removed login dialog and report `Input2SSO: Unsupported provider`.
For that error in the current attempt, agents may reload the signed-out landing page and retry once,
then verify authenticated navigation. This recovery does not run during secure handoff or discard
non-login work. The host does not rewrite site scripts or weaken cross-origin security policies.
Input dispatch runs inside those checks and queues. Upload staging also uses the shared parser before
it checks local file access.

### Tab lifetime

The agent decides when a tab closes. Nothing closes a tab when a turn ends: `close_tab` is the only
cleanup path, and the prompt asks the agent to use it once a task no longer needs the tab. A tab
therefore outlives its turn by design, which is what lets the next turn in the same thread carry on in
the page the last one left, and what lets the user read the result afterwards.

There is no user-owned tab. A tab carries `ownerThreadId` and `ownerAgentId`, and an agent may read
and close any tab in its own thread, including one the user opened there. The one hard block is a
takeover: while the user holds a tab, no agent tool touches it. That is enforced in
`BrowserHost.#requireToolTab`, which is the lowest point every tab-bearing tool passes through, so it
holds for callers that never reach `AgentService` -- the view gateway and remote hosts. The agent-wide
refusal in `AgentService` stays beside it rather than being folded in: it also covers `open` and
`list_tabs`, which name no tab, and it answers with a refusal instead of an error.

| Event | Tabs |
| --- | --- |
| Turn succeeds | Stay open unless the agent called `close_tab`. |
| Cancelled, interrupted, or failed | Stay open. Completion clears the control session only. |
| Retry | Same thread and agent, so the same tabs are still reachable. |
| Restart | Restored from the browser's own state file. |
| Idle 30 min (5 min when memory is low) | Stays open, but its page unloads. The next use loads the page again. |
| Agent deleted | That agent's tabs are closed, including a legacy tab holding only its thread id. |
| Takeover held | No agent tool touches that tab, `close_tab` included. |

Deleting an agent is the one sweep, and it exists because those tabs are otherwise unreachable: no
agent passes the owner check for them, and the renderer lists tabs per agent, so they would hold a
view the user cannot see to close, across restarts. Closing is idempotent -- `close()` returns early
on an id it does not hold -- and tab ids are UUIDs with no reorder feature at any layer, so a stale id
can never name a tab that took its place.

A member on a remote server cannot see the host's tab, because the tab is a native view on the host's
own screen. `browser-view-gateway.ts` answers that with a session and a websocket: `BrowserHost`
streams the tab through CDP, and the gateway sends each frame as bytes and dispatches the pointer and
key input that comes back, in fractions of the last frame, through the same access checks. Frames stay
outside the per-tab operation queue, so watching never delays a tool call. `browser-view-client.ts` is
the client half, and it reuses the Remote Desktop websocket tunnel rather than adding a WebRTC channel.
The `browser-view` capability says whether a host has both.

The iPhone app draws the pointer itself, so it needs the page's cursor. A host with
`browser-view-cursor` sends a `cursor` text message, from the tab's `cursor-changed` event, to a
socket opened with `cursor=1`; desktop and web clients do not ask. The phone uses the
`browser-view-clipboard` inputs of the desktop and web clients: `paste`, `copy` (answered with
`copied` or `copyTooLarge`) and `cut`, and Cmd+A for Select All. A client that reads only the
`copied` answer never asks for a cursor or a menu, so it gets no other text message. A host with
`browser-view-context-menu` sends the menu of a
right-click to the socket that made it (opened with `menu=1`) as a `context-menu` message, and opens
no native menu: that menu would show on the host's screen. Only http and https addresses go in the
message. A host with `browser-view-viewport` holds the page at the size a socket asks for with
`viewport=WxH` while that socket is open, through the same device metrics override as an agent's
`set_environment`, so a resize of the host's window does not change the page. A tab with a custom
size from `set_environment` keeps it. The phone asks for 1280x800. On the phone, the view runs in the
hidden page that holds the Team peer (`features/browser/model/browser-view-bridge.ts`). That page
sends each frame to the screen as base64 and holds the newest frame until the screen has drawn the
previous one. Back, forward, reload, new tab and close tab use the released `browser-control`
routes. The account server's `browser` mobile feature flag turns the phone's browser off for an app
version (`apps/auth-api/src/server/mobile-features-config.ts`).

## Secure browser authentication

`openbot_browser.submit_secret` uses the existing attention/takeover lifecycle with optional public
secret-request metadata. The attention registry creates a fresh request ID and owns the pending
response. The secret travels through a dedicated typed IPC endpoint or the optional
`browser-secret-handoff` Team API capability, never a prompt answer or provider tool argument.
Frozen protocol projections continue to show ordinary takeover to older clients. Current codecs
carry validated metadata beside those projections. There is no database schema change.

The browser host owns the protection state and serializes entry behind existing browser work. CDP
resolves fields before consent and checks the document and origin again before entry. The host
stops recording, suppresses page diagnostics, blocks inspection and capture, rejects remote input,
and invalidates existing live-view streams. Capture protection remains after same-document navigation
or an uncertain submission. After a completed submit action without document replacement, the host
waits up to five seconds, then empties the filled fields. When every field is empty and an automation-world scan finds the
value in no title, URL, text node, value, or attribute, including open shadow roots, it keeps the
document so a single-page sign-in can show its next step, and blocks evaluation and recording in the
opener group until a main-frame navigation, which also clears history. Otherwise it loads the current
URL with GET to replace the document without replaying a form POST. Failure retains protection and falls back to takeover. A new document releases it and
clears navigation history; manual takeover
completion alone cannot release it. Secrets are not retried. Authentication inside unsupported frames,
unclear OAuth account selection, CAPTCHA, passkeys, and payment confirmation use takeover.
