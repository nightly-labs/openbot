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
the end of the host; the host process is not changed. Renderer and child process exits other than a
clean exit are counted and written to the trace as `crash` spans at the next sample. A utility
process with the reason `killed` is not counted: OpenBot stops these processes itself. An exit in the
last minute before a quit is not counted: a stop signal can end the child processes before the
main process starts its teardown.

The pure part (`resource-summary.ts`) keeps each day as sparse histograms with two significant digits,
peaks and counters, so p95 stays exact enough without a sample list. The summary file holds the
current day and the last closed day; it is written at most every 15 minutes, at a day change and at
shutdown, and a damaged file starts a new day. `HostAnalytics.checkResources()` sends the closed day
as `system_resources` and marks it handled in the file before the send, so a crash cannot send it
twice. The file keeps the handled day for the diagnostics export until a newer day replaces it.
Nothing leaves the process with a PID, a command or a path: the summary keys are group names,
provider ids and reason words, and the analytics allowlist checks each value again.

## Agent usage analytics

`AgentUsage` owns local numeric usage records, cumulative counter checkpoints, and activity counts.
Migration 15 adds these tables on both database creation paths. They do not reference conversation
projections: clearing a conversation must retain usage. Agent deletion removes usage, checkpoints,
activity, and related command receipts in its existing transaction.

The turn lifecycle accepts usage only for a provider session belonging to the agent. Codex totals
use durable session checkpoints; restored totals establish a baseline for pre-feature sessions.
Claude uses per-model query totals and a separate counter identity for each query process. ACP usage
is optional. Missing fields remain unknown. Completed assistant messages exclude commentary and tool
output. Only post-install messages enter activity counts.

`agent:get-analytics` and the capability-gated `GET /v1/agents/:agentId/analytics` return aggregates.
They are separate from provider account limits. A request names the agent, inclusive calendar dates,
and viewer time zone. The host groups records into calendar days in that zone. Date comparisons use
an inclusive start and exclusive next-day boundary; custom ranges are limited to 367 days. Desktop
names the host explicitly, and mobile binds reads to its authenticated active host. Every member of
that host team can read totals. The public web and Signal service store no usage records.

The Usage views show 7, 30, 90, or custom days, with 30 days as the default. Both expose exact daily
values beside the SVG charts. Cost is a USD API-equivalent estimate, not a subscription charge.
The bundled rates cite official sources and carry a verification date. Claude list-price estimates
come from SDK model usage; unknown or managed pricing is not treated as a list-price estimate.
Unknown models, missing cache data, and unresolvable context or cache-write pricing stay unpriced.
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
