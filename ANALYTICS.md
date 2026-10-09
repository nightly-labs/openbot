# Product analytics

OpenBot uses a self-hosted OpenPanel project for production product analytics. This document is the
contract for event meaning, attribution, privacy, and reporting. Changes to an event name, property,
or success definition require an analytics schema version bump and corresponding test updates.

## Product metric

The primary product metric is weekly accounts with at least one successful, user-originated agent
turn. Application opens and passive page views are not meaningful activity.

Guardrails are the successful-turn rate, P90 turn duration, action failure rate, and the percentage
of activated accounts that return for another successful turn within one and four weeks.

## Global properties

Every event has these low-cardinality properties:

- `surface`: `desktop`, `desktop_host`, `landing`, `web`, `mobile`, or `account_api`;
- `environment`: currently `production` only;
- `event_schema_version`: the integer schema generation of that surface: currently `7` on `desktop`
  and `desktop_host`, `8` on `landing` and `account_api`, `2` on `mobile`, and `1` on `web`;
- `app_version` and `platform` on desktop surfaces;
- `acquisition_source` on landing surfaces: `direct`, `search`, `social`, `github`, or `other`;
- `source_platform` on landing surfaces: an allowlisted platform name, or `unknown`.

Each surface counts its own generations, so a report filters by `surface` and that surface's current
generation. Desktop and host generation 7 adds safe error causes and durable failure delivery. Generation 6 added the usage events below (`system_tool_used`,
`system_site_visited`, `system_routine_run`, `system_inventory`), `agent_source` and `agent_listing`
on host turn and input events, and `plugin` entities and `listing_slug` on `marketplace_action`.

Landing reports must filter to `event_schema_version = 8`. Generation 8 adds the article path to website
`screen_view` and the content and download-selection events below, so generation 7 cannot answer a
per-article question and must not be combined with generation 8 in one content report. Generation 5 renames the product agent throughout: the
`origin` property reports `agent` where generation 4 reported `bot`, so the two generations cannot be
combined in one report. Historical events remain available but must not
be mixed into current conversion or reliability metrics.

## Identity

- UI actions use the account captured when the action starts.
- A local host emits one lifecycle event under its owner's account.
- Clients observing a remote host do not re-emit host lifecycle.
- Landing, invitation, and pre-authentication events are anonymous.
- The account service (`account_api`) sends billing and hosted server events from the Worker, with
  the account ID as `profileId`. It never sends an email, a Stripe ID, a server ID, a name or an
  amount in another currency. It uses an OpenPanel server client (`OPENPANEL_CLIENT_ID` and
  `OPENPANEL_CLIENT_SECRET`) of the same project, and only production has these secrets. The desktop
  analytics preference does not apply to these events: the account service records a payment or a
  server change, not a UI action on the computer.
- OpenPanel receives the central account ID as `profileId` and the normalized account email as the
  profile email. Email is not copied into individual event properties.
- Existing profiles are repaired by the controlled identity backfill when their `profileId` matches
  a current account. The backfill updates profile traits only; it does not rewrite events or merge
  unknown profiles.
- The backfill is dry-run by default: `bun run analytics:backfill -- --auth-users users.json
  --openpanel-profiles profiles.json`; pass `--apply` only after reviewing the counters. Credentials
  come from `OPENPANEL_CLIENT_ID` and `OPENPANEL_CLIENT_SECRET`, and logs contain counts only.
- Local IDs for agents, servers, members, messages, threads, turns, files, or deliveries are never
  analytics properties.

Anonymous events use a dedicated OpenPanel client that is never identified. This separation is a
privacy boundary and must be covered by a real-SDK transport test, not only an SDK mock.

Desktop analytics is enabled by default and can be disabled in General settings. The preference is
stored in the main process before analytics initialization and gates both renderer events and host
lifecycle. A malformed preference fails closed; a missing preference uses the documented default.

## Event catalogue

| Event | Product question | Success definition |
|---|---|---|
| `desktop_app_opened` | How many accounts/devices open OpenBot? | App state and identity have loaded |
| `app_updated` | Did an update actually take effect? | A new version is observed on the next launch |
| `account_sign_in_started` | Can visitors start authentication? | A code was sent |
| `account_sign_in_completed` | Can visitors become verified accounts? | Verified signed-in state returned |
| `account_sign_out` | Does sign-out complete? | Logout IPC returned successfully |
| `onboarding_completed` | Which provider completes setup? | Setup state was saved |
| `provider_action` | Where does provider connection fail? | `connect_started` is intent; `connect_completed` succeeds only when provider state becomes `available` |
| `agent_action` | Can accounts create and manage agents? | Persistence operation completed |
| `message_send` | Can accounts send agent and direct messages? | Send operation returned a receipt |
| `system_turn_started` | How many host turns begin and from which origin? | Host accepted a unique turn start |
| `system_turn_completed` | Are turns reliable and fast? | Host emitted completion; status describes outcome |
| `system_agent_input_requested` | Where do agents need human input? | Host requested a prompt answer or approval |
| `system_operation_failed` | Which host/provider area fails? | Host emitted a safe, allowlisted operation code and cause code. The host sends this once; remote observers do not repeat it |
| `notification_shown` | Which errors and warnings reach users? | An error/warning toast, shared alert or chat banner, or native error/warning alert is presented. Success, information, and confirmation dialogs are excluded |
| `client_operation_failed` | Which mobile operations fail? | An existing mobile action event reports a failed result; this diagnostic report has durable delivery |
| `system_tool_used` | Which tools and plugins do agents use for their tasks? | One row per tool kind, plugin and tool in a completed turn, with call and failure counts (Claude reports no tool failures, so its `failed_count` is 0). `plugin` is a catalog slug, `builtin`, or `custom`; `tool` is sent only for `builtin` and catalog plugins. At most 32 rows per turn |
| `system_site_visited` | Which websites do users and agents work on? | A browser tab reached a new registrable domain. `actor` is `user` or `agent`; only the eTLD+1 is sent, and IP addresses, single-label names and names with no public suffix are dropped. An intranet host under a public domain is sent as that domain |
| `system_routine_run` | Do routine runs succeed, and which schedules are used? | A routine run that this host saw running reached `succeeded`, `failed`, `needs-attention`, `interrupted`, or `cancelled` |
| `system_inventory` | What have accounts set up? | At most once per local day: counts of agents, enabled routines, custom MCP servers, local and community skills, and the slugs of catalog plugins, curated skills and curated agents |
| `agent_input_action` | Can users resolve prompts and approvals? | Response IPC completed |
| `queue_action` | Can users control queued work? | Queue operation completed |
| `routine_action` | Are routines adopted and reliable? | Routine operation completed; `duration_ms` measures execution time |
| `team_action` | Does team setup and invitation convert? | Requested team operation completed |
| `browser_action` | Are embedded browser controls reliable? | Browser IPC completed |
| `search_action` | Is search useful and healthy? | Search returned a safe result count |
| `remote_desktop_action` | Is Remote Desktop usable? | Session/display operation completed |
| `update_action` | Do update checks and downloads work? | Returned status is not an error; actual installs use `app_updated` |
| `marketplace_action` | Do marketplace views convert to installs/updates? | Marketplace operation completed. `entity` is `skill`, `agent`, or `plugin`; `listing_slug` names only a curated skill or agent or a catalog plugin |
| `memory_action` | Are manual memories used? | Memory persistence operation completed |
| `voice_transcription` | Is local voice input reliable and fast? | Transcription returned text without sending it to analytics |
| `reaction_action` | Are reactions used? | Reaction operation completed |
| `maintenance_action` | Can accounts export data and diagnostics? | Export reported a saved artifact |
| `hosted_site_action` | Can accounts publish, replace, and delete Hosted Sites? | A terminal Hosted Site operation result; site metadata is never sent |
| `screen_view` | Which public website routes and articles are viewed in a session? | One safe view for `/`, `/join`, `/download`, a `/download/<os>` page, a collection index, or a published article path, with allowlisted campaign tags and no hash |
| `landing_viewed` | How much qualified landing traffic arrives? | Non-automation production page view |
| `landing_download_clicked` | Which safe channel/placement drives downloads? | Allowlisted download link clicked |
| `landing_link_clicked` | Which public resources are useful? | Allowlisted public link clicked. From the release with the download pages, the Download link in the content-page header reports `destination: download_page`, not `download_section` |
| `landing_download_selected` | Does the offered platform match the one taken? | The hero reports its detected platform once, then each manual change; `detected` separates the two |
| `content_article_opened` | Which news article or guide does a reader choose, and from where? | A link to a published article was clicked; `placement` separates an index card from the related row |
| `content_article_read` | Is an article read or abandoned? | The body reached `start`, `half`, or `end` in the viewport, at most once each per view. It measures position, not attention, and never elapsed time |
| `join_page_action` | Does the invitation web flow reach the app? | Anonymous view, download, or app-open action |
| `billing_action` | Do accounts start, pay for, change and keep paid plans? | `action`: `checkout_started`, `checkout_expired`, `plan_started`, `payment_succeeded`, `payment_failed`, `plan_changed`, `cancel_scheduled`, `cancel_withdrawn`, `plan_ended`, or `portal_opened`, as the account service stores it. Optional `plan`, `interval`, `currency`, `amount` (minor units of `currency`, from Stripe) and `flow` (Portal) |
| `hosted_server_action` | Do paid hosted servers start, stay in use and come back? | `action`: `provisioned`, `setup_failed`, `idle_stopped`, `woken`, `resized`, `plan_stopped`, `renewed`, or `deleted`, when the account service changes the server. Optional `plan`, `size`, `reason` (`message`, `restart` or `schedule`) and `error` (an allowlisted hosted server error code) |

## Privacy and runtime validation

Payloads are validated at runtime as well as by TypeScript. String enums are allowlisted, model and
version values use bounded safe formats, arrays are filtered and capped, and numeric values reject
non-finite, negative, or implausibly large inputs. Failure codes are static and allowlisted.

Never send message content, prompts, answers, generated content, search terms, URLs (a website is
reported only as its registrable domain), referrers, user-authored names such as a custom MCP server,
routine or skill name, file names, local paths, commands, tokens, invitation values, raw errors, or local
identifiers. Website events use only the fixed paths `/`, `/join`, `/news`, and `/guides`, or the
path of an article published in `src/lib/news.ts` or `src/lib/guides.ts`. Article slugs are an
editor-authored closed set, not visitor input: `safeScreenPath` and the `slug` property check look
the slug up in those registries, and a path or slug that is not there reports `/` or is dropped
rather than passed through. Paths are followed by the allowlisted campaign tags `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, and
`utm_term`. `landingCampaignPath` lowercases each tag and accepts at most 64 characters from
`[a-z0-9._-]`; a value outside that shape is dropped, not shortened, and no other query parameter or
hash is ever included. Session replay and automatic interaction capture remain disabled.

## Required dashboards

1. Product Health: weekly meaningful accounts, successful-turn rate, P50/P90 duration, and failures
   by provider/model/app version.
2. Activation: app opened, onboarding completed, provider available, agent created, message sent,
   and first successful user-originated turn.
3. Retention: W1 and W4 return to another successful user-originated turn.
4. Growth: landing view to download and invitation view to open/download, plus engaged sessions that
   contain a download click, an allowlisted public-link click, or an invitation open/download action;
   segment only by coarse acquisition source, placement, and platform.
   Content: article screen views, `content_article_opened` by placement, `content_article_read` at
   `end` over `start` per article, and the share of sessions that reach a download after an article.
   Download offer: `landing_download_selected` with `detected = true` against the platform of the
   following `landing_download_clicked`, which shows how often the detected platform is corrected.
5. Reliability: failed outcomes, safe failure codes, P90/P99 durations, and update/provider health.

Every dashboard must filter by the intended `surface` and that surface's current
`event_schema_version`. Website bounce
uses OpenPanel's standard single-`screen_view` definition. Do not emit synthetic screen views to
change it; use the engaged-session report for meaningful landing activity.

## Campaign attribution and processing delay

OpenPanel takes `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, and `utm_term` from the
query of the reported path on the event that creates the session. The landing surface sends two
events concurrently on the first page load, so the path carries the campaign tags on every event and
attribution does not depend on which request arrives first.

Sessions are written through OpenPanel's session buffer, which flushes in batches on an interval.
Campaign rows therefore appear after that flush rather than immediately; events are buffered, never
dropped. Attribution is recorded once per session: a visitor who arrives without campaign tags and
navigates to a campaign link later stays on the original session's attribution, and sessions that
were recorded before this behavior shipped are not re-attributed.

## Quality checks

- Anonymous SDK requests must not contain `profileId` after any account was identified.
- Every identified profile request contains the central account ID and normalized email.
- Website `screen_view` events contain only an allowlisted path and allowlisted campaign tags, never
  an invitation query or a hash.
- A campaign link produces a session whose `utm_source`, `utm_medium`, and `utm_campaign` match the
  link, instead of `Direct / Not set`.
- A duplicate host turn start produces one `system_turn_started` event.
- A routine run or tool use replayed from history after a restart produces no event.
- A known stored turn origin wins over a completion payload whose origin is `unknown`.
- `system_turn_completed` never exceeds starts for the same reporting window without a documented
  process restart boundary.
- Provider conversion uses `connect_completed`, never resolution of the initial connect IPC.
- An update status with phase `error` or `unsupported` is a failed action.
- Dashboard counts and profile assignment are smoke-tested after each analytics schema deployment.

## Reliable error reports

The three failure events above use a separate local queue and explicit HTTP transport. Other
product events keep their existing delivery behavior. Only production clients collect reports.
The browser app uses `surface: web` and `platform: web`; it enables collection only on
`https://openbot.run`. Marketing remains `landing` and does not send app notification events.

A report carries a fixed `operation`, `source`, `severity`, and `cause_code`. Notifications also
carry `presentation` (`toast`, `banner`, or `alert`). Host failures retain `failure_code` and
`area`, with available provider, model, reasoning effort, and turn origin. Context is captured
when a turn starts. Account changes invalidate pending scopes; an anonymous report is never
assigned to a later account. A known structured provider code takes precedence over a narrow
message match. Unrecognized causes stay `unknown`. `invalid_upload_request` means the provider
reported that failure; it does not establish why the upload was rejected.

The random `report_id` identifies this report only. It is not a chat, agent, turn, file, or server
identifier. Reports contain no message, toast text, exception text, stack trace, command, prompt,
file name, path, or arbitrary provider code. Both disk reads and new reports pass the same
allowlist before a send. Public model families retain their model ID; other model IDs report
`custom`, and custom ACP agent model IDs are omitted. Notifications that have only display text
can report an `unknown` cause. SDK path and referrer capture are not used for these requests.

Host and mobile queues use local files; desktop renderer and web queues use IndexedDB. Web Locks
serialize browser reads, writes, and sends across tabs. Browsers without Web Locks cannot send
these reports. Reports use the app version from the build that captured the event. Each queue holds at most 1,000 reports,
1 MiB, and seven days. Expired reports and then the oldest reports are removed at these limits.
A successful write must finish before a send. Only HTTP 200 or 202 acknowledges delivery. Failed
reports remain queued and move behind other reports, so one refused report cannot block them.
Requests have a 10-second deadline. Retries use exponential delays from one second to five minutes,
with jitter. Startup, browser network recovery, mobile foreground, and mobile host reconnection
also trigger a retry. Host retries continue while its process runs.

Each surface queue belongs to one account or to an anonymous session. A stored queue from another
account is discarded at startup. Opt-out and account changes cancel active sends and clear queued reports. Re-enabling does not
restore discarded reports. The browser has its own local setting under account settings. Missing
settings use the enabled default; malformed or unreadable settings disable reporting. Storage
and transport failures are silent. No report can be guaranteed after disk failure, storage
removal, expiry, opt-out, or a crash before the first write. Delivery is at least once: if an
accepted request loses its response, a retry can send the same `report_id` again.

### Reliability report definition

Filter each surface to its current schema generation. Group failures by surface, app version,
provider, model, operation, and cause. Show `unknown` causes as their own group. Count distinct
`report_id` values for durable failure events when the query supports it; never sum
`notification_shown` with `system_operation_failed` as one failure count. Notifications count
user presentations, and host events count local failures. The same failure can have both.
Compare failed turns against existing `system_turn_completed` outcomes for a turn failure rate.
Track notification counts separately by severity and presentation. No external alerts are added.

Run `bun run test:desktop -- packages/telemetry/src/reports.test.ts --maxWorkers=1` to verify a
refused HTTP send followed by restart and delivery. The test writes the received safe payloads
and result to `.openbot-build/telemetry/transport.json`. Live project access, dashboard creation,
and production delivery must be verified after deployment; local tests do not establish them.
