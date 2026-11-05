# Analytics

## Mobile product analytics

`apps/mobile/src/features/analytics` owns the React Native OpenPanel client, typed event allowlists,
account-scoped operations, the local SecureStore preference, and foreground/connection events.
Before session creation, it buffers at most 100 sanitized events in memory for 30 minutes from the
first buffered event. The next account claims this buffer; identify precedes ordered delivery with
original timestamps. Reconnects do not replay it. Expiry, opt-out, and process exit discard it.
Account changes invalidate prior operation scopes; the anonymous-to-account transition retains the
pairing scope so its completion can be recorded. Mobile uses a write-only client in the existing
Openbot OpenPanel project shared with desktop and the website.
Workspace command wrappers record outcomes once at the mobile caller; conversation availability is measured in
the visible chat view, including cached reads, not from background broadcasts. The host remains the only source of turn lifecycle
events. No Team API or database schema changes are required.

Only native production builds with mobile write credentials initialize the client, after the
preference is loaded. UI actions never await analytics transport. Account/consent generations
reject late results; ordered identity changes preserve attribution of already accepted events.
A final SDK filter replaces properties to remove SDK-added Android referrers and route paths.
The SDK's optional persistent queue and screen tracking are not enabled. Configuration, event
semantics and native verification steps are in [the mobile README](../../apps/mobile/README.md#openpanel-product-analytics).

## Website analytics

Public website tracking lives in `apps/auth-api/src/lib/analytics.ts`. It runs only on the
production `openbot.run` hostname. Landing and invitation events carry a bounded
`source_platform`, the existing `acquisition_source` category, and a domain-only referrer.

A recognized `utm_source` tag takes precedence over the referring domain. Exact domain and
subdomain matches select known platforms; URL paths and substring matches do not. Unrecognized
platforms use `unknown`. No referral signal retains the coarse `direct` category, which does
not prove a visitor typed the address.

An article reports its own path, so one article can be told from another. `safeScreenPath` and the
`slug` property check resolve the path against the `src/lib/news.ts` and `src/lib/guides.ts`
registries, so the reportable set stays closed: an unknown slug reports `/` and is dropped from the
payload. `articleFromPath` gives the delegated click listener the same lookup, which is what lets it
track article cards at all; their hrefs carry a slug and cannot be matched by the exact-href
allowlist the other links use. The hero selector reports its detected platform through
`trackDownloadSelected` before the page component calls `start`, so a short bounded queue holds
events until the client exists rather than dropping the first one.

`landingCampaignPath` rebuilds the reported screen path with only the five allowlisted `utm_*` tags,
lowercased and bounded to 64 safe characters; every other parameter and the hash are dropped by
construction. The path travels on every event of the page load, not only `screen_view`, because
OpenPanel reads campaign attribution from whichever event creates the session, and the two events
are sent concurrently.
See [PRIVACY.md](../../PRIVACY.md) for the data boundary.

`rememberLandingFirstTouch` saves the first visit in `localStorage` (`@openbot/contracts/first-touch`
owns the shape, the parser and the 90-day age). The web client sends it with `email/verify`, and
`/billing/return` sends it with the Checkout Session ID to `POST /api/browser/checkout-attribution`.
`AccountAttribution` (`src/server/account-attribution.ts`) checks it again, keeps the first value
for each account in D1 `account_attribution`, and sends `account_attributed`. `BillingSales` copies
it to the `payment_succeeded` and `revenue` ledger events. The flow and its limits are in
[ANALYTICS.md](../../ANALYTICS.md#first-touch-attribution).

The OpenPanel Growth dashboard uses a session funnel from `landing_viewed` to
`landing_download_clicked`. A download click is not a completed download or installation.
Break down the funnel by `acquisition_source`, then `source_platform` once schema version 8
events reach OpenPanel. Historical events do not contain the new platform property.

The `/download/<os>/latest` Worker handler falls back to the releases page when the GitHub manifest cannot be
read. That fallback is written to the Worker log, not to OpenPanel: a server event has no session,
and the landing dashboards are defined on sessions.

For download-click reports, `platform` means the requested macOS, Windows, or Linux download;
`placement` means the button location. These properties exist only on the download step.
Use them to compare click counts, not as a shared visit-to-click funnel breakdown.
The invitation-page funnel is separate: `join_page_action` with `action=view` followed by
`action=download` or `action=open_app`.

## Resource sampling

`ResourceMonitor` (`src/main/resource-monitor.ts`) samples once a minute while the computer is awake.
It reads `app.getAppMetrics()` for the Electron processes and groups them by type: the utility process
`name` separates the database and voice hosts, and `BrowserHost.tabProcessIds()` separates browser
tabs from windows. On macOS and Linux one `ps` call lists all processes. The descendants of the main
process that are not Electron processes form the provider trees: a PID that a spawn site registered
in `src/backend/provider-processes.ts` names its provider, its children inherit it, an unregistered
`claude`, `codex`, `opencode` or `grok` executable names itself, and every other process is `other`.
Windows reports `provider_tree_supported: false`. A sample with a failed `ps` records no total. CPU
comes from the change in each process's CPU time between two listings, so a command that starts
and ends between two samples, such as a short tool run, is not counted. The main event loop uses
`monitorEventLoopDelay`, less its 20 ms timer interval.
Database time comes from `AgentDatabaseSupervisor`, from the send of a statement to its answer or to
the end of the host. The supervisor sends a statement only after the host reports ready, so the
start of the host process is not counted. Renderer and child process exits other than a
clean exit are written to the trace as `crash` spans at once, and counted at the next sample. A
utility process with the reason `killed` is neither: OpenBot stops these processes itself. An exit in
the last minute before a quit is not counted: a stop signal can end the child processes before the
main process starts its teardown. The trace still has it, after the `exit` span of that quit.

`index.ts` writes one `exit` span and one line in `logs/main/main.log` when OpenBot starts to quit.
The name is the first reason: `main_window_closed` (Windows and Linux, where closing the main
window quits), `signal`, `session_end` or `quit` (the menu, the tray, an update or a restart). The
main log holds every line of the `main` logger, redacted, in two files of 1 MB. `crashReporter`
keeps local crash dumps in `app.getPath("crashDumps")` and never uploads them. A process that ends
with no `exit` span and no dump was stopped from outside OpenBot (#2675).

`run-marker.ts` keeps `openbot-run-marker-v1.json` in the user data folder of the process that holds
the single-instance lock. It writes `running` at the start, the time of the last sign of life once a
minute and at sleep and wake, `quitting` with the reason in `recordExit`, `quit_timeout` before the
shutdown deadline exit, and `clean` after `teardown.runAll()`. It adds no teardown step, so the
ordinals do not change. The writes are synchronous, so a late write cannot replace a later state. At
the next start, `RunMarker.start` reads the file before it writes the new one. A `running`,
`quitting` or `quit_timeout` file is an unclean exit, except a quit for `update` or `session_end`
and a run that saw the `powerMonitor` `shutdown` event. It counts the `.dmp` files in
`crashDumps` with a time after that run's last sign of life, by name and time only, and compares
that time with the boot time. `HostAnalytics` sends the result once as `system_unclean_exit` and
keeps it in memory only. `scripts/unclean-exit-e2e.ts` kills the dev app's main process, quits
it with SIGTERM, and checks the event and the marker on each start. `bun run dev:stop` sends SIGKILL
to the process group after 3 s, so a dev stop can count as `quitting`.

The pure part (`resource-summary.ts`) keeps each day as sparse histograms with two significant digits,
peaks and counters, so p95 stays exact enough without a sample list. The summary file holds the
current day and the last closed day; it is written at most every 15 minutes, at a day change and at
shutdown, and a damaged file starts a new day. `HostAnalytics.checkResources()` sends the closed day
as `system_resources` and marks it handled in the file before the send, so a crash cannot send it
twice. The file keeps the handled day for the diagnostics export until a newer day replaces it.
Nothing leaves the process with a PID, a command or a path: the summary keys are group names,
provider ids and reason words, and the analytics allowlist checks each value again. The day also
keeps the phase of the longest main-loop delay (`mainLoopPeak`, optional so older files still
decode; the phase is any string in the file and the event drops a value outside its enum), and
child exits by process type. A minute with a delay of 1 s or more writes a `stall` span to the
trace.

App windows (`src/renderer/src/renderer-timing.ts`) count long tasks and input delays with
`PerformanceObserver` and send the counts at most once a minute over `app:report-renderer-timing`.
The main handler decodes bounded counts only; `ResourceMonitor` buffers them and adds them to the day
at the next sample. The same channel carries the main window's `workspaceReady` flag:
`StartupTiming` (`src/main/startup-timing.ts`) reads the time on the main clock and sends one
`system_startup` per main process from the `openbot:*` startup marks. It keeps the last start in
`startup-history.json` to tell a cold start from a warm one. Turn timing comes from the drain
scheduler and `TurnLifecycle`, which keep the queue pick, the provider start and the first output of
each turn until `HostAnalytics` takes them at `turn-completed`.

`RemoteConnectTrace` (`src/main/remote-connect-trace.ts`) times each connection to a remote host for
the trace file and gives `HostAnalytics` one summary, sent as `system_remote_connect`: when an attempt
makes its first request, and for the first failed attempt after a connection or a cancel. Later
failures are counted in the next connection. An attempt is keyed by the id that `begin` returns, so
an old attempt that ends late does not change a newer one. The host id stays in memory and is never
sent. `RemoteServerManager` adds the time since its hosted start request. The account service times
the hosted start itself: `start_requested_at` on `hosted_servers` holds the request time, and the
first observation of a usable sandbox clears it and sends the `ready` action once.

## Agent usage analytics

`AgentUsage` owns local numeric usage records, cumulative counter checkpoints, and activity counts.
Migration 15 adds these tables on both database creation paths. They do not reference conversation
projections: clearing a conversation must retain usage. Agent deletion removes usage, checkpoints,
activity, and related command receipts in its existing transaction.

The turn lifecycle accepts usage only for a provider session belonging to the agent, in its own chat
or in one of its tasks. It finds the session in the public thread of the provider thread. Codex
totals use durable session checkpoints. The Codex counter `:codex:cache-writes` replaces `:codex`,
which counted cache writes as uncached input. When the counter has no checkpoint, it starts from the
session totals before the last request (`total` minus `last`). Thus the requests that `:codex`
counted, task requests from before task metering, and requests from before migration 15 do not
count. The last request counts, also in a session from before migration 15. An update with no
`last` or no turn ID establishes a baseline.
Claude uses per-model query totals and a separate counter identity for each query process. ACP usage
is optional. Missing fields remain unknown. ACP usage is a session total, with one counter for each
session, except from Antigravity: 1.4.3 sends the tokens of one prompt, so each prompt result has its
own counter, and its `thoughtTokens` count as output. Completed assistant messages exclude commentary and tool
output. Only post-install messages enter activity counts.

`agent:get-analytics` and the capability-gated `GET /v1/agents/:agentId/analytics` return aggregates.
They are separate from provider account limits. A request names the agent, inclusive calendar dates,
and viewer time zone. The host groups records into calendar days in that zone. Date comparisons use
an inclusive start and exclusive next-day boundary; custom ranges are limited to 367 days. Desktop
names the host explicitly, and mobile binds reads to its authenticated active host. Every member of
that host team can read totals. The public web and Signal service store no usage records.

The Usage views show 7, 30, 90, or custom days, with 30 days as the default. Both expose exact daily
values beside the SVG charts. Cost is a USD API-equivalent estimate, not a subscription charge.
The bundled rates cite official sources and carry a verification date. A rate with a scheduled
change uses the rate in force when the turn started. Claude list-price estimates
come from SDK model usage; unknown or managed pricing is not treated as a list-price estimate.
Codex cache writes use the 30-minute cache-write rate. An update under the provider's long-context
threshold uses the short rates. An update over it uses the long rates only when it is one request
(its input equals the `last` prompt); ACP reports no such prompt, so a Grok update over it stays
unpriced. Unknown models, missing cache data, and unresolvable context or cache-write pricing stay
unpriced.
Tool and media fees are outside the estimate. Stored estimates retain their price basis.

### Host-wide Usage

Desktop opens Usage from the server context menu. It keeps the previous workspace mounted and
inert until Back, so conversation drafts and settings survive navigation. Agent settings opens
the same report with an agent filter. Host changes clear the filter and stale responses are rejected.
The iPhone app opens Usage from the server menu in a sheet. It reads the same route through
`readHostAnalytics` in `@openbot/team-client` and shows the per-agent rows; a row or the header
filter narrows the report to one agent. The agent Usage page reads the same route with the agent
filter, so its chart has the provider split too; a host without `host-analytics` gets the
agent-scoped route and one area. The series pivot is in `@openbot/team-client/usage-series`, which
the desktop chart also reads.

`host:get-analytics` and the optional `host-analytics` capability expose `GET /v1/analytics`.
The host queries its local usage tables once for the date range and optional agent filter; it does
not add per-agent API responses. The one pass groups by agent id beside day and model, so the
host-wide response carries per-agent rows that the client labels from the agent list it already
reads. The same pass also groups by day and provider, which is what lets the chart draw one area
per provider over a shared baseline; a cell carries only the token count and the cost estimate,
because those are the two measures the chart reads. Both arrays are on the host report only, which
is why the agent-scoped route and its codec are unchanged. Session and turn identities include agent and provider. HTTP and
WebRTC use an explicit host analytics codec. Existing agent analytics and account limits keep their
contracts. All authenticated team members can read these aggregates; no additional analytics data
is stored by the account service or Signal service.

The desktop chart adapts Zaidan's chart and interactive area composition. The pinned
`solid-recharts` dependency has a Solid 2 compatibility patch and uses the application's single
Solid runtime. Chart colors use OpenBot tokens. Daily tables provide exact accessible values.
