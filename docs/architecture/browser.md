# Browser

## Browser client

`apps/auth-api` serves `/app`. Its lazy route mounts the interactive client after browser startup.
`src/renderer/src/features/web-client` owns the browser composition and its typed
`WebWorkspaceRuntime` interface. It mounts the existing account login, page rail, server rail,
sidebar, and full conversation view. `ConversationRuntime` routes host actions through
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
checks still apply. `web-account.ts` makes these calls, and the Profile tab of the web Settings dialog
(`WebAccountSettings.tsx`) shows them.

An owner or admin gets the host controls of a desktop remote admin. Shared components keep their
desktop port as the default and take injected calls: `web-server-settings.ts` gives
`ServerSettingsModal` the host identity, MCP, and storage routes through
`@openbot/team-client/team-admin-requests`, and member and invitation calls through the closed
`/api/browser/*` list. The Worker applies the same `RemoteControlPlane` role checks as the bearer
routes. A member or role change revokes every session on the host; the browser reconnects once when
the directory still lists the host. `ConversationRuntime.admin` carries the skills and shared-table
calls to the agent settings panel, which shows only Skills and Tables in the browser. Memories,
routines, and files stay on the desktop. The Permissions select writes access and auto-approve through
the agent-admin route. `web-marketplace.ts` gives `MarketplaceModal` its calls: the public catalog routes of
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
sign-in logic (`provider-connection.ts`, `ProviderSettingsSection.tsx`) as the desktop app. On
desktop the section shows the providers of the active server only, because provider state exists
only for that server; for another server it offers to switch. The
browser applies host `status` events, and reads the status every 3 seconds while a code sign-in waits.
A provider key stays in the dialog input until it is sent to the host.

Browser sign-in, account reads, and connection tickets are always available. No host or D1
migration is needed. See [web client delivery](../web-client.md) for the seven review scopes, local
commands, and release checks.

Browser chat pages, drafts, file bytes, and chat visibility preferences stay in memory. A protected
cookie holds the account credential. Local storage holds account-scoped trusted host public keys,
the shared file panel's width, and for each account and host the pinned item ids (a copy of the list
that a host with `sidebar-pins-v1` keeps), collapsed section ids and selected channel id, not chat
content. The channel UI takes a `ChannelsPort` runtime; its
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

ZIP attachments use the same contract with `application/zip` and no inline preview. Import copies
and hashes the archive; OpenBot never extracts it. Remote support is additive through the
`zip-attachments` capability.

MP4 attachments use the MP3 and MOV contract with `video/mp4`. Remote support is additive through
the `mp4-attachments` capability, because a host with only `media-attachments` refuses MP4.

SVG attachments are stored as `image/svg+xml` with `kind: "file"` and `previewKind: "image"`. The
type comes from the file extension. Providers take only raster image blocks, so delivery sends the
path as a mention and the agent reads the SVG text. The attachment schemes serve SVG with a `sandbox`
policy. The browser client shows an SVG thumbnail from a `data:` URL, never from an object URL: an
object URL has the origin of the app. Remote support is additive through the
`svg-attachments` capability, which only protocol 9 peers get.

A file whose name has no known type is stored as `application/octet-stream` with `kind: "file"` and
`previewKind: "none"`. Import drops a MIME type that the importer supplies for such a name, because a
sent attachment takes its type from the name, and because a HEIC or TIFF must not become an image
block that a provider refuses. Only the voice recording keeps its `audio/webm` type. Delivery sends
the path as a mention. The desktop app
never opens such a file with the default app (`OPENABLE_ATTACHMENT_EXTENSIONS`). Remote support is
additive through the `any-file-attachments` capability, which only protocol 9 peers get. Clients keep
the extension list for a host without it.

## Browser tool execution

`browser-tools.ts` defines provider schemas and parses each call into a typed tool and its arguments.
`browser-tool-actions.ts` maps input tools to CDP operations. It does not own tabs or import the host.
`BrowserHost` owns tab access checks, operation queues, focus, deadlines, and persistent browser state.
Targeted typing checks that the target still holds focus before the End key, the text, and the
Enter key. A page focus or input handler that moves focus stops it with an error that says if the
text is already in the field. The check also reads each frame element that holds the target,
because a frame in another process can keep its active element after the page takes focus.
`bun run test:browser --scenario=typing-focus` covers it and writes
`.openbot-build/browser-typing-focus.json`.
The browser session and service-worker fallback remove the `OpenBot/` and `Electron/` user-agent
tokens. They keep the installed Chromium major version and host platform, and give the other version
parts as `0.0.0` (`Chrome/156.0.0.0`), as Chrome does: some bot checks refuse the full version that
Electron sends. The `Accept-Language` header adds the base language of each regional language
(`en-GB,en;q=0.9`), also as Chrome does. Requests to `accounts.google.com`
keep the `Electron/` token because Google rejects the account identifier step without it. This
exception does not change the page identity or the identity sent to other sites.
Electron provides native `navigator.userAgentData` but no client-hint request headers. On HTTPS and
loopback HTTP, the host supplies the brand list, desktop flag, and platform hints. The brand list must
be the same as `navigator.userAgentData.brands`, with the GREASE brand and its order (Chromium
chooses both from the major version). Cloudflare rejects a request whose brands differ from the page.
It preserves hints supplied by Chromium. As Chrome does, it adds a high-entropy hint (full version,
platform version, architecture, bitness, model, form factor) only after the response of a page load
of that origin asks for it with `Accept-CH`, and only on requests from a page of that origin. Each
value is the one that `getHighEntropyValues()` gives the page. The record is in memory, so the first
load after a restart is as a first visit. Windows sends no platform version: the page reads a
contract version that the host cannot compute. The focused check is
`bun run test:browser --scenario=identity`; add `--google-live` for the Google identifier check.
The local identity report is `.openbot-build/browser-identity.json`.
Website popups are adopted into managed `WebContentsView` tabs through Electron's window creation
hook. Native guests retain their opener, request body, and the browser session of the opener. Local tab and
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

An agent tab refuses cookie banners (`browser-consent.ts`). On `dom-ready`, the host runs a small
script of its own in an isolated world of the main frame. For up to 15 seconds, it looks for one
visible reject button: the button of a common consent platform, or a button whose whole label
refuses optional cookies ("Reject all", "Only necessary", and the same in some other languages)
inside a dialog, a fixed or sticky box, or a consent container that shows the word "cookie". Text
such as "consent" alone does not count, because sign-in and terms dialogs show it too. It also
looks in open shadow roots, because some platforms build the banner from web components. It clicks
that button once and stops. It never accepts, so a banner with no reject button stays. A tab that a
person opened keeps its banner, and so does a secret tab. A takeover, user control or secret entry
stops the script of the current page. The site stores the refusal in the profile of the tab, so a
later tab on that site in the same profile shows no banner either. Banners in frames (for example
Sourcepoint) are not handled. `bun run test:browser --scenario=cookie-banner` covers it and writes
`.openbot-build/browser-cookie-banner.json`.

Each snapshot also looks for a bot check (`browser-challenge.ts`). It reads the DOM of the main frame
in an isolated world: vendor markers of the interstitial page (Cloudflare, DataDome, PerimeterX,
Imperva, Akamai, AWS WAF) and, only on a short page, captcha frames and phrases such as "verify you
are human". A long page that only mentions a captcha does not count. A check that passes by itself
(`non-interactive`) makes the tab read wait: it reads the page again every second for up to 15
seconds, and stops at once when the tab closes, a person takes control, or the tab holds a secret.
All reads of one document share the 15 seconds: a read with a shorter timeout, such as `navigate`,
leaves the rest for the next read and reports `checking`, whose `next` asks for a snapshot. A
check that stays after the full wait reads as `needs-user` at once.
The snapshot then has a `challenge` field with `status` (`cleared`, `checking`, `click-once`,
`needs-user` or `blocked`), the vendor, the wait, and `next`, the step that the agent takes. A check
that needs a person asks for `request_takeover` (in a routine run, a report). A block asks for a
report. Each `next` also tells the agent not to solve, reload, or retry the check, so the guidance
needs no separate rule.

Many checks of the Turnstile, reCAPTCHA and hCaptcha widgets pass with one click on their checkbox.
The script finds the frame of a widget of the normal size in the viewport and gives the checkbox
point, 28 px from the left edge and in the middle. Turnstile puts its frame in a closed shadow root,
which the page script cannot see, and its host element is as wide as the form. When the script
finds a Turnstile response field without a token, the main process finds the frame through CDP:
`DOM.getFrameOwner` for each child frame, also for frames in other processes, then the frame's
`src` and its box from `DOM.getBoxModel`. A field without a visible frame (invisible mode) is not a
check. A Turnstile widget often passes by itself in 1 to 2 seconds, and an early click can look like
a bot, so the read that would offer its checkbox first waits up to 3 seconds for a token. The first
read of a document that still needs a person then has `click-once` and a `point` target in place of `needs-user`. The agent clicks it with the
ordinary `click` tool, so ownership, user control and the cursor stay the same. The next read of
that document waits up to 6 seconds for the check to pass; a visible image puzzle or a block ends the
wait at once, because only a person solves a puzzle. Later reads of the document ask for a person
and do not offer the click again. A widget whose response field has a token passed: neither its
frame nor the generic phrases count then, because the page keeps its text. The host never solves a
puzzle and sends no page data to a solver service. The idea and the vendor
list come from anomalyco/browse; the code is our own.

`bun run bench:browser-tools --tasks=challenge-interstitial,challenge-interactive` measures it with
loopback pages (Haiku, 5 runs each, 2026-11-07). On a check that needs a person, the agent before
clicked "I am human" and read the page again: median 7 tool calls, $0.033 for 5 runs. With the
`challenge` field, it stopped at once in every run: median 2 calls, $0.016. On a check that passes
after 4 seconds, the agent opens the page with `navigate`. Before, it waited and read again: median
4 calls and 129k input tokens. After, `navigate` returned the page behind the check: median 2 calls
and 75k tokens.

A memory can name a site (`site`, migration 60): a lowercase host without `www.`. The agent sets it
with `openbot.remember` (a host or a URL), for example how to work a site. A snapshot of a page then
has `siteMemories`, up to 5 of the agent's memories for the page's host and its parent domains
(`app.example.com` also shows `example.com`), newest first. A tab shows them one time per host and
turn, so the next pages of the same site in that turn do not show them again. A secret tab shows none.
An essential memory is already in the agent's instructions with its site, so a snapshot leaves it out.
Only a snapshot that reached the agent counts as shown. The host reads them from SQLite
(`AgentMemoryStore.forHost`); nothing leaves the computer except the snapshot that goes to the
provider, as for every other snapshot field. The Team API leaves out `site`, so the released memory
shape stays the same. An instance transfer does not carry the site.
The background memory review can add or update a memory with a `site` too. Its prompt asks it to keep
how one site works, as the agent found it in the chat (where a control is, a step that worked after
one failed), as a site memory, and a class of task as a skill. The review drops a site that is not a
host and keeps the fact. The browser guidance has no site memory text: the agent context budget
(`tools/agent-context/budget.json`) leaves no space for it, and the review saves these steps.

"Learn from my browsing" (Server settings → General → Agents, off by default, `browsing-memory-v1`)
lets the review also learn from what a person does in an agent's tab. `BrowserHost` records steps only
while a person holds the tab (takeover or Take control), so no step is the agent's own. It skips a
secret tab, a private sign-in, a tab without an owner agent, and a page that is not http(s). A step is
a page that loads (host, path and title, without the query or the hash; `stepPlace` replaces a
path part that looks like a code, such as a reset token, with `:id`) or a press on a control
(`input-event` mouseDown; `browser-user-click.ts` reads the role and the name in isolated world 1020,
with a 1 second limit). A press outside a control, on a password field, or on a field whose
`autocomplete` is a password, a one-time code or a card value, gives no step. A field gives its label,
never its value; key presses are never read. `UserBrowsingLog` keeps the steps in
`openbot-browsing-steps-v1.json` (no migration), the newest 80 per agent. The next memory review of the
agent reads all of them in a `<user_browsing>` block, with secrets redacted, and deletes the steps
that it read after its result decodes. A step that no review read goes after 30 days (at start and at
each change). Turning the setting off deletes the file, and deleting an agent deletes its steps. Only
the review reads the steps; the agent has no tool to search them. Browsing alone does not start a
review: the steps wait for the next review of that chat. `bun scripts/browser-user-control-e2e.ts`
covers the capture rules in Electron, and `bun run test:memory-review` covers the review.

"Teach a task" (composer `+` menu, `browser-teach-v1`) uses the same step recorder for a task that a
person shows on purpose. It does not depend on the setting above. The menu item opens the full view
with a teach bar above the page (`BrowserTeachBar`) and no dock; "Start recording" in the bar calls
`startTeach`. `BrowserHost.startTeach` gives the
agent's tab to the person and keeps the steps in memory for that tab, not in `UserBrowsingLog`: at
most 200 steps and 10 minutes, with the same rules for a page and a press. The bar then shows the
time on a button that saves the recording, a discard button, and a frame around the page. `stopTeach` gives the tab back; only the
holder that started the recording can end it, and it gets the steps only with `save`. The recording
also ends, with no steps, when the control of the tab ends. On Save the client sends a short
user message that asks for a skill and a plain answer, with the numbered steps in an attached text
file `recorded-task.txt` (`browser-teach-message.ts`, `sendCardFile`), and closes the full view so that
the chat shows. The request is in the message, not in the file: an agent does not obey a file. A
recording with no step after its first page sends nothing and shows a toast. When the chat cannot
send, the steps go to the draft as text. The host stores no step. The
menu item is not in a channel and not on mobile: a task of many steps on a web page does not fit a
phone. `bun scripts/browser-user-control-e2e.ts` covers the recording, and
`bun run test:team-api-routes` covers the routes.

When the first read of a snapshot finds a loading marker that a person can see (`aria-busy="true"`,
or a class that contains `skeleton` or `shimmer`), the snapshot waits in the page until the markers
go and the DOM is unchanged for 150 ms, for up to 2 seconds, and reads again (`browser-settle.ts`).
A page that keeps its marker for the full wait does not wait again until its next document. A
document younger than 2.5 seconds with no controls waits for its first change: for up to 1 second
while it loads, and only until 500 ms after its load event once it has loaded. A loaded static page
without controls, or a document that already waited for its first change, does not wait. Each
wait ends 1 second before the read's timeout.
Without this wait, the agent read the placeholders and took a second snapshot. Chromium already
leaves the content outside a modal dialog (`showModal()`) out of the accessibility tree, so the
snapshot has no modal-first order.

`bun run bench:browser-tools --tasks=spa-skeleton` opens a page that shows a skeleton for 1.5 seconds.
Before, `navigate` returned only the heading, and the agent took a second snapshot in all 5 runs:
3 calls and 101k input tokens. After, `navigate` returned the prices: 2 calls and 75k tokens in all
5 runs.

Three changes remove agent turns at the start of a browser task:

- `open` returns the first snapshot of the new tab, as `navigate` does. A failed read returns the tab
  and a redacted `snapshotError`.
- The first browser result in a thread brings the schemas and guidance of `open`, `snapshot`,
  `navigate`, `click`, `type`, `wait_for` and `run_script` (`browserToolsPrimer` in
  `tool-catalog.ts`), unless a search or describe result already gave them. The developer
  instructions show the exact `tool_call` form for `open`, `list_tabs` and `snapshot`, so the agent
  can call one before any `tool_search`. Without the exact form, the agent guessed the argument shape.
- The `run_script` helpers accept the forms that models write from other libraries:
  `waitFor("text", "x")`, `waitFor({ selector })`, `waitFor(cond, 5000)`, `{ timeout }`, the states
  `visible`, `attached` (a target wait already waits for a box) and `networkidle` (as `dom-quiet`),
  and `role("button", { name })`. `sleep(ms)`, `setTimeout` and `waitFor(ms)` run a `sleep` step of
  at most 25 seconds. An unknown form throws a message with the accepted forms.

`bun run bench:browser-tools --tasks=open-order,open-quotes,click-wait,herokuapp-dynamic` measures
them (Haiku, 5 runs each, 2026-11-07; `open-order` and `open-quotes` start with no tab). Medians:

| Task | Before | `open` snapshot + helpers | + first-result schemas |
| --- | --- | --- | --- |
| open-order | 3 calls, 101k tokens | 2 calls, 74k | 1 call, 51k |
| open-quotes | 4 calls, 129k | 2 calls, 76k | 1–2 calls, 52–76k |
| click-wait | 4 calls, 129k | 4 calls, 129k | 5 calls, 138k |
| herokuapp-dynamic | 4 calls, 131k | 4 calls, 131k | 3 calls, 104k |

All 20 runs were correct in each column. With the schemas in the first result, 19 of 30 runs (with
`consent-overlay` and `spa-skeleton`) made no `tool_search`; before, every run made one. On
`click-wait`, `wait_for` with `dom-quiet` returns before the 3-second timer of the page, so the agent
waits again; that cost did not change. The helpers did not change a median. The forms that they
accept come from failed scripts in the bench transcripts.

On the 10 default tasks (3 runs each), all 30 runs were correct before and after. Tool calls went
from 97 to 84 and input tokens from 1.12M to 0.97M; 23 of 30 runs made no `tool_search`.

### Repair argument forms that agents write

Each refused call costs the agent one turn of about 27k input tokens. Before the decoder of a tool or
a `run_script` step reads the arguments, `browser-tool-input.ts` rewrites the forms that agent
transcripts show again and again. The advertised schemas do not change, and a form that can mean two
things stays a refusal:

- A target can be a ref string (`"3:main:12"`), a whole snapshot line (`3:main:12 link "Travel"`), a
  role line (`link "Travel"`), `css #main`, or a CSS selector. The `run_script` helpers send a string
  target as it is, so a step takes the same forms. An object without `kind` gets it from its fields (`ref`, `selector` or `css`, `role`, `text`,
  or `x` and `y`). A ref target without `revision` takes it from the ref, and a top-level `ref` on an
  action tool becomes its `target`.
- `type` takes `replace` or `clear` as `mode`: `true` is `"replace"`, and `false` is `"append"`.
- `wait_for` drops `snapshot` and a `condition` that names a field of the call
  (`{ condition: "text", text }`), maps the Playwright and Puppeteer states (`networkidle`, `idle`,
  `quiet` as `dom-quiet`; `complete` as `load`; `interactive` as `domcontentloaded`), and drops
  `visible` and `attached` on a target wait.
- `fill_fields` takes `value` as `text`, and takes `revision` from the refs when they all have the
  same one.
- `open` drops a `tabId` and opens a new tab, so the page in that tab stays. A call written as
  `{ name: "openbot_browser.<tool>", arguments }` is unwrapped, and a snake_case field such as
  `tab_id` takes its camelCase name when the call does not also give that name. The user-control
  check reads the same repaired `tabId`.
- The Vault, secret and payment tools (`submit_secret`, `fill_card`, `list_logins`,
  `list_vault_items`, `save_vault_item`, `request_vault_item`, `delete_vault_item`,
  `request_link_payment`) get no repair. Their targets must come from a snapshot, and
  `save_vault_item` registers the raw `password` for redaction before the decoder runs.

In `run_script`, `role(role, name, { exact })`, `waitFor(role(...))`, `waitFor("Done", "text")` and
`waitFor("#done", "visible")` work. A `waitFor` function
that calls `evaluate`, `snapshot` or `step` is written for the sandbox, so the script polls it once a
second until its timeout; other `waitFor` functions, such as one that calls `document.evaluate`,
still run in the page. A `ReferenceError`
for `document`, `window`, `location`, `page` or `$` says that the script runs in a sandbox and reads
the page with `evaluate`.

A replay of the 173 failed calls since 2026-10-30 that the current tools can run again (from the
desktop agent transcripts, against the current decoders and a fake page) gave 79 accepted calls
before this change and 140 after. Most of the others read page globals in the sandbox, call removed
tools, or fail on the fake page.

`bun run bench:browser-tools --variants=S --tasks=herokuapp-dynamic,herokuapp-add-remove,books-travel,wikipedia-rust,spa-skeleton,click-wait,quotes-love-tag --repeats=3`
(Haiku, 2026-11-08) counts failed calls in each run. All 21 runs were correct before and after.
Tool calls went from 72 to 64 and input tokens from 2.07M to 1.95M; failed calls stayed at 6, because
each run fails on different forms. `herokuapp-dynamic` went from 4–6 calls and 116k median input
tokens to 2 calls and 63k in all 3 runs. The failures that stay are agent mistakes: an ambiguous
target, which the tools refuse on purpose, `document` read in the sandbox, and the Playwright
`>> nth=N` selector, which has no CSS form.

### Fill inspected ordinary fields

`openbot_browser.fill_fields` is a deferred tool in the original browser catalog. It replaces
1 to 16 main-frame native text inputs or textareas from one fresh snapshot revision. The combined
literal text has a 16 KiB UTF-8 limit. The total operation deadline, including its final capture,
is at most 30 seconds. It performs no submit, Enter, click, navigation, target search, or caller
script. Existing individual controls keep their behavior. Its control event uses the released
`type` action.

The engine retains the exact native handles for every field in one CDP lease. Preflight resolves
and checks the full set before any input. It refuses duplicate or unavailable refs, hidden,
disabled or readonly fields, contenteditable, frames, password inputs, one-time-code autocomplete,
and payment-card autocomplete. It accepts native input types `text`, `search`, `tel`, `url`, and
`email`, plus textarea. HTML metadata is not a complete detector for secrets or form side effects.
Agents must first inspect the ordinary form. Authentication, payments, and uncertain user
decisions use the existing secure input or takeover flow.

Each fill rechecks the same native handle, snapshot fingerprint, original field value, editable
metadata, main-frame document and origin. It does not find a replacement for a changed target.
The native navigation generation and document node identity detect same-URL reloads. Focus handlers
receive a second check before trusted input. The host rechecks tab ownership, secret protection,
and takeover before each field and before it releases a final capture. CDP emulates page focus;
the operation requests no native window or application focus.

One tab queue slot owns all fields, one final page settle, and one bounded final semantic snapshot. Successful input is
confirmed by its native field value. The result contains zero-based `confirmed` indices,
`failedIndex`, and `uncertainIndex`, without field text or page exceptions in the progress record.
`partial` means earlier fields can remain changed. An input sent without confirmed completion is
uncertain. `inputCompleted: true` with `status: snapshot_failed` means input completed but capture
failed. Callers must read the page before they decide how to continue. No automatic retry, undo,
or atomic transaction is promised.

Cancellation prevents undispatched fields. Dispatched input and its confirmation drain before the
queue slot ends. A response deadline can return sooner, but later tab operations still wait for
that owned work. An external debugger that the host cannot cancel must drain its command. The
engine releases retained handles and its lease at completion. Known failures use fixed reason
codes; page exceptions do not enter the new progress result or diagnostic action.

`bun scripts/browser-fill-fields-e2e.ts` compiles only its native fixture and uses an owned hidden
Electron process with a temporary profile and synthetic loopback forms. It must not make a window
visible or request native focus to obtain a passing result. It is a local check, not a CI step; on
Linux, run it under `xvfb-run -a`. The report is `.openbot-build/browser-fill-fields-e2e/report.json`.
It includes actual runtime versions, completed cases, three warm-up pairs and twenty measured pairs,
serialized result bytes, and observed snapshot counts. Measurements include tool execution and loopback fixture
confirmation. They do not measure provider tokens, model speed, or billable cost.

### Run many steps in one call

Each single action tool takes one model turn, and the model reads the page with a separate snapshot.
`openbot_browser.run_script` does many actions in one call and returns one final snapshot, so a long
task takes fewer turns.

`run_script` takes JavaScript that awaits helpers named after the action tools (`navigate`, `click`,
`type`, `press`, `hover`, `scroll`, `selectOption`, `setChecked`, `waitFor`, `evaluate`, and
`snapshot`), or `step({ action, ...fields })` with the fields of that tool and no `tabId`. Each
helper sends one step to the host. The script returns a JSON value of at most 64 KB. An `evaluate`
step gives its value to the script, not to the model, so it can return up to 1 MB, such as the whole
text of a page.

An earlier `run_steps` tool took a fixed list of steps. A benchmark with Claude Haiku 5.5 on 10 public
site tasks (3 repeats) gave `run_script` 118k median input tokens and 30 of 30 correct answers, and
`run_steps` 130k. With both tools in the catalog, agents used both, at 198k. So the catalog has only
`run_script` (`bun run bench:browser-tools`). With the shipped guidance and no hint in the prompt,
agents used 216k until a browser search also returned `run_script` (see
[Providers](providers.md)); then 149k. These runs were before input actions returned a short status
in place of a snapshot, so the token counts can be different now.

The script runs each step through the same code as the single tool, with its own tab queue slot.
Before each step, the host checks the tab again: ownership, secret protection, takeover, and user
control. The action steps read no result. `evaluate` keeps the scripted-origin
record and the secret-document check. When a person takes control of the tab, the call stops and
returns its partial results with status `user_control`. It does not wait for the release. The
control event uses the released `click` action, so the Team API wire values do not change.

An `evaluate` step returns `null` when the expression gives `undefined`, such as a click statement.
The single `evaluate` tool still refuses that value. If the step failed after the click, the agent
would click again. In a script, `waitFor` also takes a page function: the page polls it every
100 ms until it returns a truthy value, in one `evaluate` step (at most 25 seconds). A script that
fails without a final snapshot returns the tab's `url`, because the steps before the failure stay
done and the agent must not start again from the wrong page. When the final snapshot fails after
the last step, the result keeps the script's value and log. It has `snapshotError`, or the
`user_control` status when a person took the tab.

The script runs in a QuickJS WebAssembly sandbox (`src/backend/browser-script.ts`), not in
`node:vm`, because the backend process holds the vault. The sandbox has no modules, network, files,
timers, or process. Its limits are 64 MiB of memory, a 1 MiB stack, 200 steps, and a total deadline
of `timeoutMs` (default 60 seconds, at most 120 seconds). An interrupt handler stops a script that
loops without steps. Each script gets its own runtime, which the host disposes at the end. The
backend bundle keeps the QuickJS packages external, so the WebAssembly file loads from
`node_modules`.

`bun run test:browser-steps` compiles its native fixture and drives a hidden Electron process with
loopback pages, like the fill fields check. CI runs it in the `browser` job under `xvfb-run -a`.
The report is `.openbot-build/browser-steps-e2e/report.json`.

### Browser sessions

Each agent has one **browser profile**: the persistent partition that its new tabs open in. The agent
fields `ownBrowserSession` and `browserProfileId` (`agent_json`) select it:

| Choice | Partition |
| --- | --- |
| Shared (default) | `persist:openbot-browser` |
| Only this agent | `persist:openbot-browser-agent-<key>`. The key is the first 32 hex characters of the SHA-256 of the agent id. |
| Named profile | `persist:openbot-browser-profile-<id>`. The id is 32 random hex characters. |

Named profiles are rows of the `browser_profiles` table (migration 45). Many agents can use one
profile, so they share its sign-ins; a profile has no owner agent, and the tab rules below do not
change. The name is a label only and never becomes a path or a partition, so a rename keeps the
data. An agent with `browserProfileId` also has `ownBrowserSession: true`. After a downgrade, an
older build thus opens such an agent in a session of its own, never in the shared one. A duplicate
keeps the named profile of its source. Other duplicates and imported agents start with Shared, because
an "Only this agent" copy would get a new, empty partition. The user's tabs in an agent's panel use the agent's partition, so
the user can sign in for the agent there.

`openPrivate` opens a sign-in page for another person in an in-memory partition. The tab is not
saved, and its storage is cleared when its last tab closes.

A tab keeps its partition for its life, and its popups use the same partition. The state file
saves an agent key as `agentSession`, and a named profile as `profile` together with an
`agentSession` key made from the profile id, which an older build reads. A restart restores each tab
in its saved partition, whatever the setting is now. A tab without a key, such as a tab from an older
version, opens in the shared partition. A tab with a malformed key or profile id, or with the id of a
deleted profile, is dropped, so it never opens signed in to another account. A new tab for an agent
whose profile no longer exists fails with `browserProfileMissing`; it never falls back to Shared.
`#configureSession` applies the same user agent, headers, permissions and download policy to every
partition. Shutdown and `flushPersistentStorage` flush every persistent partition.

`src/main/browser-profile-service.ts` owns the operations: list, create (name of 1 to 60
characters, unique, at most 100 profiles), update (name or color), clear data, delete, and assign.
Clear and delete close the tabs in the partition before they clear its storage and cache. Delete also
moves the profile's agents to Shared. Each named profile has a color (`hue`), one of the agent avatar
hues. Create gives the color that the fewest profiles use (`nextBrowserProfileHue`); Server settings >
Browser profiles changes it. The browser view shows a profile label with its color on the toolbar, a line in
that color under the tab, and the name in the tab tooltip of a tab outside the shared profile
(`agent:admin:list-browser-tab-profiles`). The select marks Shared with a gray dot, a color that no
named profile has. "Only this agent" has no color, and the select offers it only to an agent that
already uses it, so the agent keeps its sign-ins. An owner or admin of a joined server uses the same
operations through `browser-profiles-v1` (`route-browser-profiles.ts`); each member reads the labels of
the tabs that they can see, and a private tab is hidden from a member. A host without the capability
answers `agentSettingsUnsupported`, and the client shows no select, section or label for it. A host
with `browser-profiles-events-v1` sends `browser-profiles-changed` after each change, so every open
list and agent setting reads the profiles again. The phone shows the same operations in Server
settings > Browser profiles and in Agent info > Advanced > Browser profile.

A named profile can use a saved proxy (migration 56: `browser_proxies` and `browser_profile_proxies`).
Without one it is "Automatic": `{ mode: "system" }`, the proxy settings of the computer that runs
OpenBot. The shared profile and "Only this agent" are always Automatic. A proxy is one address,
`scheme://[user[:password]@]host[:port]` with socks5, http or https (`parseBrowserProxyAddress`).
Without a scheme it is http and needs a port: `user:password@host:port` or the
`host:port:user:password` form of proxy sellers. The password can contain a raw `/`, `#` or `@`.
Chromium does not sign in to SOCKS5, so a SOCKS5 proxy with a sign-in goes through a relay in main
(`browser-proxy-relay.ts`): an HTTP proxy on a random port of 127.0.0.1 with a random sign-in, which
the `login` handler gives. The relay signs in to the SOCKS5 proxy (RFC 1929), sends the site name
for the proxy to resolve, and opens one SOCKS5 connection for each browser connection. A plain http
request closes its connection after the answer. When the SOCKS5 proxy refuses or does not answer,
the relay answers 502. A proxy change, a session clear and the host shutdown stop the relay and its
connections, also when the new proxy fails to apply. The password goes to
`SecretStorageCipher` before it is saved, is decrypted only in main when a tab needs it, and never
goes back to a client or a log. The Edit dialog shows a saved password as a mask; a save that keeps
the mask sends `keepPassword`, and the host keeps the password. Without it, an address with no
password removes the password. A save that does not change the address sends nothing, so it closes
no tabs. At most 50 proxies. The clients name a proxy by its host; when two saved proxies have the
same host, the name adds the port, then the user name, then the scheme (`browserProxyName`). The
page error of the host names the host only. Chromium's implicit bypass rules stay: `localhost` and
loopback addresses go direct on the host, not through the proxy. Before a tab opens, `BrowserHost.#applyProfileProxy` sets the proxy on the partition, closes
its open connections and clears its auth cache. When that fails the tab does not open: there is no
direct fallback. A tab with a proxy uses the WebRTC policy `disable_non_proxied_udp`, so WebRTC does
not show the real address. The `login` handler answers a proxy sign-in at most 8 times for each page.
A main-frame connection error marks the proxy `unreachable`. A 407, a SOCKS5 refusal of the
sign-in that the relay records, or an HTTP proxy sign-in that the `login` handler stops answering,
marks it `signIn`; Chromium reports that last one as a failed tunnel. The next page that loads
clears the mark. The page error takes the mark that the network error recorded, and it reads the
Chromium code when a failed load gives no error name. A page error names the proxy (`browserProxyUnreachable`, `browserProxySignInRefused`,
`browserProxyComputerUnreachable`); each change sends `browser-profiles-changed`. A change of a profile's proxy, or of a
proxy that profiles use, closes their tabs; the settings ask first when tabs are open. A delete moves the profiles to Automatic (foreign key
`ON DELETE CASCADE`). Changes run one at a time. Two admins can still change one proxy: a save sends
the address that the dialog opened with, and a delete sends the profiles that the question showed.
The host refuses either one when the proxy is different now (`browserProxyChanged`), so a profile
never changes to Automatic without an admin seeing it. Server settings > Browser profiles shows a
Proxies section and a Proxy submenu in each named profile's menu when the host has
`browser-proxies-v1`. The phone shows the same proxy list, Edit page and Proxy choice (`server-browser-proxy-screen.tsx`), with the same checks of `previousAddress`, `keepPassword` and the profiles that a delete saw; it cannot share its own connection, because the phone app has no TCP sockets. For an owner or an admin, the agent's
profile select and the toolbar label of a tab also show the proxy. The renderer matches the tab
profile to the proxy list by name, so `BrowserTabProfile` of `browser-profiles-v1` does not change.

A proxy can also be the computer of a member (`kind = 'computer'`, one row for each `member_id`).
The member selects "Use your computer…" in the Proxy submenu, or Share in the Proxies section, of a
joined server. The desktop app then stores the server id in `browserEgressServerIds`
(`remote-server-store.ts`), calls `/v1/admin/browser-proxies/computer`, and opens the
`openbot.browser-egress.v1` data channel while it is connected (`BrowserEgressClient`). The host binds
the channel to the membership that signed in on that peer (`BrowserEgressHost.peerMemberChanged`);
the newest open peer of a member carries its connections. A tab of a profile with a computer proxy
uses the same loopback relay, with `BrowserEgressHost.exit` as its exit: each browser connection
becomes one stream of the channel (`browser-egress-mux.ts`). The client resolves the name itself
and connects only to a public address (`isPublicAddress`), on any port; it refuses loopback,
private, link-local, carrier-grade NAT, multicast and reserved addresses, so the server cannot reach
the member's network. When the member's app is closed or stops sharing, the computer is offline:
its connections fail with 502, there is no direct fallback, and the list shows it offline. Stop
sharing closes the channel; the row stays until an admin deletes it. Neither end logs a target or
a byte. Only an owner or an admin can share, because the routes are `browser-proxies-v1` admin routes.

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
| Idle 15 min (5 min when memory is low) | Stays open, but its page unloads and its renderer process ends. The next use loads the page again. |
| More than 3 idle tabs loaded | The least recently used ones beyond 3 sleep as above once they are idle for 2 min. A tab in use (shown, busy, held, recording, playing audio, or with a secret) does not count. |
| Agent deleted | That agent's tabs are closed, including a legacy tab holding only its thread id. Its own browser session is cleared. |
| Browser profile changed | That agent's tabs are closed. Its next tab opens in the profile it chose. Both profiles keep their data. |
| Profile cleared or deleted | Every tab in that profile is closed, then its data is cleared. |
| Takeover held | No agent tool touches that tab, `close_tab` included. |
| Renderer crashed | Stays open. The next browser call loads the page again (see below). |

Deleting an agent is the one sweep, and it exists because those tabs are otherwise unreachable: no
agent passes the owner check for them, and the renderer lists tabs per agent, so they would hold a
view the user cannot see to close, across restarts. Closing is idempotent -- `close()` returns early
on an id it does not hold -- and tab ids are UUIDs with no reorder feature at any layer, so a stale id
can never name a tab that took its place.

When the renderer of an agent tab crashes (`render-process-gone`), the host adds a `load` diagnostic
and keeps the tab. The next browser call on the tab loads the same address again with `loadURL`
before it runs, because a CDP command to the crashed page gets no answer. The next snapshot reports
the crash and says that refs from before it are stale. A `run_script` that runs during the crash
stops at once with `page_crashed`, and its final snapshot loads the page again. Before, the step
waited for its timeout. A tab with a secret, a typed card, a takeover or user control is not loaded
again, because a reload could send a form again or lose the work of the person.
`bun run test:browser-steps` covers the crash, the settle wait and the bot check, and writes
`.openbot-build/browser-steps-e2e/report.json`.

### Page dialogs

A page `alert` or `confirm` that an agent action opens goes to that agent; every other dialog stays in
Electron's native box for a person. `runTabAction` watches for a dialog only while the agent's own
input action runs (`BrowserDialogTurn` names the thread and turn), and until the page settles after it.
The engine then sends `Page.enable` on its own debugger and keeps the debugger attached while a watch
runs, so it also sees a dialog that a page load or a timer opens with no command in flight. A tab
queue drain ends the watch. `Page.javascriptDialogOpening` ends the action with the dialog:
an opaque id, the type, and the message, scrubbed and redacted like snapshot text. A `run_script` step
stops with status `dialog`. The agent answers with `handle_dialog`, which sends
`Page.handleJavaScriptDialog` and returns the next dialog or the page status. Until then, every other
tool on that tab is refused; `close_tab` still works.

Electron shows its own box for the same dialog, after the CDP event. After the CDP answer, the engine
emits Electron's internal `-cancel-dialogs` on the tab, which aborts the box without its callback. The
agent gets a dialog only when the engine owns the debugger and Electron has a `-cancel-dialogs`
listener. Otherwise, for example under an external debugger, the result says that a person must answer.
`scripts/browser-dialogs-e2e.ts` fails if an Electron upgrade changes these internal events.

| Event | Dialog |
| --- | --- |
| Person's click, or a tool that is not an input action | Native box. The agent is not told. |
| Turn ends | Handed off: the box stays for a person, and the agent can no longer answer it. |
| Person answers first | `handle_dialog` fails with "This dialog is closed". |
| Tab closed or browser destroyed | The engine detaches its debugger, so the tab queue drains. Then it cancels every box of the tab, a person's box too, also a box that shows after the close: Electron keeps a box open after its page closes. |
| `prompt()` or `beforeunload` | Electron answers `prompt` with no box, and `will-prevent-unload` handles `beforeunload`. Not intercepted. |

The agent never gets a dialog that an `evaluate`, `wait_for`, or `fill_fields` call opens, or one in a
cross-origin frame: those dialogs stay native.

A member on a remote server cannot see the host's tab, because the tab is a native view on the host's
own screen. `browser-view-gateway.ts` answers that with a session and a websocket: `BrowserHost`
streams the tab through CDP, and the gateway sends each frame as bytes and dispatches the pointer and
key input that comes back, in fractions of the last frame, through the same access checks. Frames stay
outside the per-tab operation queue, so watching never delays a tool call. `browser-view-client.ts` is
the client half, and it reuses the Remote Desktop websocket tunnel rather than adding a WebRTC channel.
The `browser-view` capability says whether a host has both.

The mobile app (iOS and Android) draws the pointer itself, so it needs the page's cursor. A host with
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

A password can also go to the Vault of the server that runs the agent. The local app sends
`saveToVault` over IPC. A remote client sends the same submit on `browser-secret-vault-v1`, which
only an owner or admin can use; the released route keeps its fields. The card shows the save box on
every password request, and for a member or an older host it shows the box off with the reason.

`openbot_browser.request_vault_item` asks the user to add a login, a card or contact info that the
Vault does not have. The attention registry surfaces a `form` UI block with `uiBlock.vault.kind`.
The agent can fill in the fields that are not secret; the password, card number and security code
are secret form fields, so the stored block never holds them. The desktop card opens the Vault
dialog with the agent's values. The host saves the answer through `VaultItems.addEntered` (owner or
admin only) and answers the tool with only the item's id, kind and name. The `ui-blocks-v1` wire
leaves out `vault`; `ui-block-vault-v1` (protocol 9) adds it back, and the mobile app then shows the
same card, which opens its Vault item form with the agent's values and answers the prompt with the
form's field ids. Another remote client shows the ordinary form. Messaging threads refuse the tool.

The browser host owns the protection state and serializes entry behind existing browser work. CDP
resolves fields before consent and checks the document and origin again before entry. The host
stops recording, suppresses page diagnostics, blocks inspection and capture, rejects remote input,
and invalidates existing live-view streams. Capture protection remains after same-document navigation
or an uncertain submission. After a completed submit action without document replacement, the host
waits up to five seconds, then empties the filled fields and their `value` attributes, which React
keeps in step with the value. When every field is empty and an automation-world scan finds the
value in no title, URL, text node, value, or attribute, including open shadow roots, it keeps the
document so a single-page sign-in can show its next step, and blocks evaluation and recording in the
opener group until a main-frame navigation, which also clears history. Otherwise it loads the current
URL with GET to replace the document without replaying a form POST. Failure retains protection and falls back to takeover. A new document releases it and
clears navigation history; manual takeover
completion alone cannot release it. Secrets are not retried. Authentication inside unsupported frames,
unclear OAuth account selection, CAPTCHA (after the one checkbox click that a snapshot offers),
passkeys, and payment confirmation use takeover.
