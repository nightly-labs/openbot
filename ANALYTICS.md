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
- `event_schema_version`: the integer schema generation of that surface: currently `12` on `desktop`,
  `11` on `desktop_host`, `10` on `landing`, `12` on `account_api`, `4` on `mobile`, and `2` on `web`;
- `app_version` and `platform` on desktop surfaces;
- `acquisition_source` on landing surfaces: `direct`, `search`, `social`, `github`, or `other`;
- `source_platform` on landing surfaces: an allowlisted platform name, or `unknown`.

Each surface counts its own generations, so a report filters by `surface` and that surface's current
generation. Host generation 11 adds `system_workflow_run` and `workflow_count` on `system_inventory`.
Desktop generation 12 adds `workflow_action`. Host generation 10 adds `provider_auth` on `system_turn_completed`. Desktop generation 11 adds `trigger` on the `interrupt` action of
`voice_conversation_action`. Desktop generation 10 adds the billing, license and activation events
(`hosted_server_plans_action`, `limit_reached`, `license_action`, `sales_contact_clicked`,
`billing_return_viewed`, `onboarding_step`, `usage_limit_action`, `agent_template_action`,
`mobile_connect_action`, `connector_action`, `computer_use_action`, `help_link_opened`,
`channel_action`, `server_transfer_action`, `usage_viewed` and `analytics_preference_changed`),
`method` and four actions on `provider_action`, `attachment_kinds` on `message_send`, `path` and
`skipped` on `onboarding_completed`, two `team_action` actions, and removes `maintenance_action`,
which had no sender. Web generation 2 sends the desktop product events from `/app`, with
`surface: web`; generation 1 sent only failure reports. Mobile generation 3 adds sign-in, pairing
`entry_point`, plans, onboarding, notification, Live Activity, voice and template events. Mobile generation 4 adds
`marketplace_action` for agent, skill and plugin installs and agent updates, without `listing_slug`. Desktop generation 9 adds `voice_conversation_action`, `voice_turn`, `speech_reply`,
`speech_model_action` and `speech_settings_action`. Desktop generation 8 adds `hosted_server_upsell`. Host generation 9 adds the token
properties of `system_turn_completed` and `system_token_usage`. Host generation 8 adds `system_resources`. Desktop and host generation 7 adds safe error causes and durable failure delivery. Generation 6 added the usage events below (`system_tool_used`,
`system_site_visited`, `system_routine_run`, `system_inventory`), `agent_source` and `agent_listing`
on host turn and input events, and `plugin` entities and `listing_slug` on `marketplace_action`.
Account service generation 10 adds `account_created`, `account_attributed`, the `first_touch_*`
properties on `payment_succeeded` and `revenue`, `reactivated` on `plan_started`, and `end_reason`
on `plan_ended`. Account service generation 11 adds licenses to `billing_action` and `revenue`
(`product` is `server` or `license`; a license adds `users`), `entry_point` on `checkout_started`,
and the license fields of `billing_snapshot`. Account service generation 12 adds `email_sent`.

Landing reports must filter to `event_schema_version = 10`. Generation 10 adds
`billing_return_viewed` and `contact_form_submitted`. In generation 9, an iPhone or Android visitor
reports `ios` or `android`, not `macos` or `linux`, and a phone app store link counts as a download.
Generation 8 adds the article path to website
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
- The account service (`account_api`) sends account, billing and hosted server events from the
  Worker, with the account ID as `profileId`. It never sends an email, a Stripe ID, a server ID, a name or an
  amount in another currency. It uses an OpenPanel server client (`OPENPANEL_CLIENT_ID` and
  `OPENPANEL_CLIENT_SECRET`) of the same project, and only production has these secrets. The desktop
  analytics preference does not apply to these events: the account service records a payment or a
  server change, not a UI action on the computer. `email_sent` has no account, so it has no
  `profileId`, as `billing_snapshot`.
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

From web generation 2, the web app (`/app`) sends the desktop product events with `surface: web`
and `platform: web`, through the same allowlists. It sends only from a production build on
`https://openbot.run`. The "Share product analytics" setting of the web app gates these events and
the failure reports. It is on by default, is stored in the browser, and a storage failure turns it
off. Turning analytics off on any surface first sends one `analytics_preference_changed` event.

## Event catalogue

| Event | Product question | Success definition |
|---|---|---|
| `desktop_app_opened` | How many accounts/devices open OpenBot? | App state and identity have loaded |
| `app_updated` | Did an update actually take effect? | A new version is observed on the next launch |
| `account_sign_in_started` | Can visitors start authentication? | A code was sent. Mobile from generation 3 adds `method: email`, `duration_ms` and `cause_code`; a resend sends it again |
| `account_sign_in_completed` | Can visitors become verified accounts? | Verified signed-in state returned. Mobile from generation 3 adds `method: email` |
| `account_sign_out` | Does sign-out complete? | Logout IPC returned successfully |
| `onboarding_completed` | Which provider completes setup, and by which path? | Setup state was saved. `path` is `free` (a provider on this computer) or `plan` (a hosted server); `skipped` is true when the user skipped setup |
| `onboarding_step` | At which setup step do users stop? | A setup step was shown (`viewed`) or left with `next`, `back` or `skipped`. Desktop `step`: `choose`, `plan`, `computer`, `language`; mobile `step`: `hello`, `server`, `agent`, `look`, `name`, `role`, `task`, `ready`. Optional `path` as on `onboarding_completed` |
| `provider_action` | Where does provider connection fail? | `connect_started` is intent; `connect_completed` succeeds only when provider state becomes `available`. From desktop generation 10, `method` is `browser`, `code` or `api_key`; `sign_in_cancelled` (result `cancelled`) is a sign-in that the user stopped; `api_key_saved` is a saved provider API key; `custom_provider_saved` and `custom_provider_removed` send no provider |
| `agent_action` | Can accounts create and manage agents? | Persistence operation completed |
| `message_send` | Can accounts send agent and direct messages? | Send operation returned a receipt. From desktop generation 10, `attachment_kinds` lists each kind once: `image`, `document`, `spreadsheet`, `zip`, or `other`. File names and types are not sent |
| `system_turn_started` | How many host turns begin and from which origin? | Host accepted a unique turn start |
| `system_turn_completed` | Are turns reliable and fast, and how many tokens do they use? | Host emitted completion; status describes outcome. From host generation 9, a turn that this host saw start adds `token_usage` and the counts that the provider reported for the turn: `uncached_input_tokens`, `cached_input_tokens` (cache reads), `cache_write_tokens`, `output_tokens`, and `total_tokens` (the sum of the sent counts). The counts come from the usage records of the local Usage view, summed over all models of the turn; `model` is the agent's model. `system_token_usage` has the counts of each model `token_usage` is `reported`, `partial` (a count is missing and is not sent), or `unknown` (the provider reported no usage before completion; no count is sent, never 0). From host generation 10, `provider_auth` is how the turn is paid for: `subscription` (a provider plan, such as a ChatGPT plan or OpenCode Go, also when a key signs in to it), `api_key` (a key the user saved), `free` (a free model or a free plan), `custom` (an endpoint that the user added, local or remote) or `unknown`. The host reads it from the sign-in type that the provider CLI reports and from whether a key is saved; it never sends the key or the account |
| `system_agent_input_requested` | Where do agents need human input? | Host requested a prompt answer or approval |
| `system_operation_failed` | Which host/provider area fails? | Host emitted a safe, allowlisted operation code and cause code. The host sends this once; remote observers do not repeat it |
| `notification_shown` | Which errors and warnings reach users? | An error/warning toast, shared alert or chat banner, or native error/warning alert is presented. Success, information, and confirmation dialogs are excluded |
| `client_operation_failed` | Which mobile operations fail? | An existing mobile action event reports a failed result; this diagnostic report has durable delivery |
| `system_token_usage` | Which providers and models use the tokens? | From host generation 9, one row per provider and model that has usage records in a completed turn, with that model's `token_usage` and counts as on `system_turn_completed`. `provider` and `model` name the model that used the tokens, such as a Claude subagent's model, which can differ from the agent's model; `reasoning_effort` is not sent. A turn with no usage records sends no row. At most 8 rows per turn, the largest totals first |
| `system_tool_used` | Which tools and plugins do agents use for their tasks? | One row per tool kind, plugin and tool in a completed turn, with call and failure counts (Claude reports no tool failures, so its `failed_count` is 0). `plugin` is a catalog slug, `builtin`, or `custom`; `tool` is sent only for `builtin` and catalog plugins. At most 32 rows per turn |
| `system_site_visited` | Which websites do users and agents work on? | A browser tab reached a new registrable domain. `actor` is `user` or `agent`; only the eTLD+1 is sent, and IP addresses, single-label names and names with no public suffix are dropped. An intranet host under a public domain is sent as that domain |
| `system_routine_run` | Do routine runs succeed, and which schedules are used? | A routine run that this host saw running reached `succeeded`, `failed`, `needs-attention`, `interrupted`, or `cancelled` |
| `system_workflow_run` | Do workflow runs succeed, how do they start, and which steps do they use? | From host generation 11, a workflow run that started after this host process started ended. `status` is `done`, `failed` or `stopped`; `source` is `manual`, `schedule` or `webhook`; `duration_ms` (at most 30 days, else not sent); `step_count` of the nodes that ran, and `agent_step_count`, `model_step_count` (model and condition steps), `approval_step_count` and `output_step_count`. A retry can end a run again: each outcome of a run is sent once. Titles, texts, node IDs, agents, addresses and places are never sent |
| `system_inventory` | What have accounts set up? | At most once per local day: counts of agents, enabled routines, workflows (from host generation 11, `workflow_count`), custom MCP servers, local and community skills, and the slugs of catalog plugins, curated skills and curated agents |
| `system_resources` | How much CPU and memory does OpenBot use, by computer class and provider? | At most once per local day, the summary of the last closed local day that has samples. A sample is taken once a minute while the computer is awake. Memory in MB rounded to 50 and CPU percent as integers, as the 95th percentile of the samples (`_p95`) or the largest sample (`_max`), for all processes (`total_`), each process group (`main`, `window`, `browser_tab`, `gpu`, `database_host`, `voice_host`, `utility_other`) and the process tree of each provider id (`provider_<id>_`, `provider_other_` for any other child process). `main_loop_delay_ms_p95` is the 95th percentile of each minute's p99 main event-loop delay; `_max` is the longest delay. `db_request_ms_*`, `db_request_count` and `db_slow_request_count` (over 100 ms) time agent database statements. `renderer_gone_count`, `child_gone_count` and `gone_<reason>_count` count processes that ended for a reason other than a clean exit, except in the minute before a quit; A utility process that OpenBot stops itself, such as the voice host after idle time or a database host at a statement deadline, is not counted. The peak active turns, browser tabs and provider processes; `ram_class`, `cpu_class`, `arch`, `host_kind` (`desktop` or `server`), `provider_tree_supported` (false on Windows, or when `ps` failed), and `sample_count`. A day that closes while analytics is off is dropped, never sent later |
| `agent_input_action` | Can users resolve prompts and approvals? | Response IPC completed |
| `queue_action` | Can users control queued work? | Queue operation completed |
| `routine_action` | Are routines adopted and reliable? | Routine operation completed; `duration_ms` measures execution time |
| `workflow_action` | Are workflows adopted, and which canvas actions fail? | From desktop generation 12, a workflow operation that the user started completed. `action`: `create`, `rename`, `delete`, `run`, `run_step`, `stop_step`, `stop_run`, `retry_step`, `approve`, `reject`, `restore_version` or `rotate_webhook_secret`. `run_step` adds `node_kind` when the node is saved. `duration_ms` measures the call. Failures: `create_failed`, `update_failed`, `delete_failed`, `request_failed`, `cancel_failed`, `response_failed`. The workflow that the app makes when a server has none is not sent. Titles, texts, IDs and secrets are never sent |
| `team_action` | Does team setup and invitation convert? | Requested team operation completed. From desktop generation 10, `invite_link_copied` and `invite_qr_shown` show how an invitation is shared |
| `browser_action` | Are embedded browser controls reliable? | Browser IPC completed |
| `search_action` | Is search useful and healthy? | Search returned a safe result count |
| `remote_desktop_action` | Is Remote Desktop usable? | Session/display operation completed |
| `update_action` | Do update checks and downloads work? | Returned status is not an error; actual installs use `app_updated` |
| `marketplace_action` | Do marketplace views convert to installs/updates? | Marketplace operation completed. `entity` is `skill`, `agent`, or `plugin`; `listing_slug` names only a curated skill or agent or a catalog plugin. Mobile from generation 4 sends `install` and `update` with no `listing_slug` |
| `memory_action` | Are manual memories used? | Memory persistence operation completed |
| `voice_transcription` | Is local voice input reliable and fast? | Transcription returned text without sending it to analytics |
| `voice_conversation_action` | Do users talk to agents in the Voice pane, and for how long? | `action`: `start` (both voice models are ready; `duration_ms` includes a speech model download; fails with `load_failed`), `end` (the pane closed; `duration_ms` of the conversation and `turn_count` of sent turns), `interrupt`, `mute`, or `unmute`. From desktop generation 11, `interrupt` has `trigger`: `button` (the Stop button) or `voice` (the user spoke while the agent thought or spoke). `server_kind` is `local` or `remote`; `transcription` is `local` or `cloud`. Mobile from generation 3 sends `start` and `end` only, with `server_kind: remote` and no `transcription` |
| `voice_turn` | Does a spoken turn reach the chat? | The transcribed text was handed to the send queue; delivery itself is `message_send`. `audio_duration_seconds` of the recording, `duration_ms` to transcribe, `recording_kept` (local server only). Failures: `microphone_failed`, `transcription_failed`, `no_speech` (the turn ended with no words), `send_failed`. Mobile from generation 3 sends `server_kind: remote`; iOS sends no `transcription` |
| `speech_reply` | Are spoken replies fast and listened to? | A reading ended. `trigger` is `voice_conversation`, `dictation` or `read_aloud`; `completed` is false when the user or a new turn stopped it; `first_audio_ms` from the start of the reading to its first sound, without the agent's turn; `audio_duration_seconds` of the parts that played. Failures: `load_failed` (the reply did not load), `speech_failed` |
| `speech_model_action` | Does the voice model download? | `action` `download` returned a ready model. `entry_point` is `settings` or `voice_conversation`; `duration_ms`; failures `download_failed` or `cancelled` |
| `speech_settings_action` | Is "Read replies aloud" used, and which voices? | The setting was saved. `action` is `read_replies_on`, `read_replies_off`, or `voice_changed` with `voice` (`F1`–`F5`, `M1`–`M5`) |
| `reaction_action` | Are reactions used? | Reaction operation completed |
| `hosted_site_action` | Can accounts publish, replace, and delete Hosted Sites? | A terminal Hosted Site operation result; site metadata is never sent |
| `hosted_server_upsell` | Does the hosted server offer lead to the plans without too many dismissals? | The offer shows, or the user selects "See plans" or dismisses it. `entry_point` is `routine_created`, `routines_list`, or `server_offline`; routine and server names are never sent. From web generation 2 the web app sends it too. "See plans" opens the plans with `entry_point: upsell` |
| `hosted_server_plans_action` | Do users who open the plans pick a plan, and where did they come from? | Desktop, web and mobile. `action`: `viewed`, `currency_changed`, `interval_changed`, `plan_selected`, `create_failed`, `payment_open_failed`, `retried`, `closed`, `join_opened`, or (mobile) `setup_opened`. `entry_point`: `server_rail`, `settings_billing`, `upsell`, `empty_state`, `checkout_resume`, `drawer`, `onboarding`, or (web, from the pricing page) `pricing_page`. Optional `plan`, `interval`, `currency`, `failure_code`. The checkout itself is the account service `checkout_started` with the same `entry_point` |
| `limit_reached` | How often does a limit stop a user, and what do they do next? | `kind` is `servers`, `members` or `license_users`; `action` is `shown`, `manage_clicked`, `confirmed`, `dismissed`, or `contact_clicked`. Optional `role` of the invited member |
| `license_action` | Do accounts buy and change licenses from the app? | UI steps only; the account service sends the billing result. `action`: `buy_opened`, `checkout_opened`, `users_change_requested`, `plan_change_requested`, `cancel_requested`, `cancel_kept`, `renewal_resumed`, or `over_limit_shown`. Optional `result`, `direction` (`up` or `down` for a users change) and `failure_code` |
| `sales_contact_clicked` | Where do users ask to talk to sales? | A contact sales link was opened. `entry_point` is `add_server`, `license`, or `members` |
| `billing_return_viewed` | Do users come back from Stripe with a completed payment? | The web app or the website showed the page after Stripe. `outcome` is `completed` or `cancelled`; `kind` is `plan`, `license` or `portal`. The website reads `kind` from the return address, which the account service sets from generation 11; an older return address has no `kind`. Its `screen_view` path is `/billing/return` with no query, so the Checkout Session ID is not sent. The page sends no `landing_viewed` and saves no first visit |
| `contact_form_submitted` | Does the website contact form reach us? | Website. `topic` is `setup`, `partnership`, `press` or `other` (an unknown topic is left out); `result` is `succeeded`, `failed` or `rate_limited`. The message, name and email are not sent |
| `usage_limit_action` | What do users do when a provider usage limit stops a turn? | `action`: `shown`, `model_switched` (with `to_provider` and `to_model`), or `waited`; `from_provider`. A custom agent model, and a model of an OpenCode custom provider, is sent as `custom` |
| `agent_template_action` | Are agent templates published, shared and installed? | `action`: `published`, `updated`, `unpublished`, `link_copied`, or `installed`; `result`; `entry_point` is `deep_link` or `in_app`. Mobile sends only `installed` with `entry_point: deep_link` |
| `mobile_connect_action` | Do users connect the phone app to the computer? | `action`: `code_shown`, `link_created`, `connected`, `cancelled`, `revoked`, or `link_revoked`; `result`; `failure_code` |
| `connector_action` | Which connectors are set up, and where do they fail? | `connector`: `slack`, `discord`, `telegram`, `github`, `onepassword`, or `bitwarden`; `action`: `connect_started`, `connected`, `disconnected`, `enabled`, or `disabled`; `result`; `failure_code`. Account and workspace names are not sent |
| `computer_use_action` | Do users grant the Computer Use permissions? | `permission_opened` with `permission` `screen-recording` or `accessibility` |
| `help_link_opened` | Which help links are used? | `destination` is `discord`, `feedback`, `guides`, or `changelog` |
| `channel_action` | Are channels created and used? | `action`: `created`, `archived`, or `member_added`; `result` of the change. A failed refresh after a done change is not a failure. Channel names are not sent |
| `server_transfer_action` | Do server exports and imports work? | `action` is `export` or `import`; `result` (`cancelled` when the user closed the save dialog); `failure_code` `export_failed` or `import_failed` |
| `notification_settings_action` | Do mobile users keep notifications on? | Mobile. `action`: `enabled`, `disabled`, `preview_toggled`, `live_activities_toggled` (with `enabled`), or `permission_prompted` with `permission` `granted`, `denied` or `undetermined`, sent only when the system prompt shows |
| `live_activity_action` | Are iPhone Live Activities used? | Mobile. `action` is `started` or `ended`. A Live Activity left from an earlier launch that the app ends also sends `ended` |
| `usage_viewed` | Is the Usage view used? | Desktop and mobile. `scope` is `agent` or `server`. Desktop adds `range` (`7d`, `30d`, `90d`, `1y`) and `filtered` (an agent filter that the user selected); each change of these sends again |
| `analytics_preference_changed` | How many users turn product analytics off? | Desktop, web and mobile. `enabled: false`, sent once before tracking stops. Turning analytics on sends nothing |
| `screen_view` | Which public website routes and articles are viewed in a session? | One safe view for `/`, `/join`, `/contact`, `/teams`, `/pricing`, `/download`, a `/download/<os>` page, a collection index, or a published article path, with allowlisted campaign tags and no hash |
| `landing_viewed` | How much qualified landing traffic arrives? | Non-automation production page view |
| `landing_download_clicked` | Which safe channel/placement drives downloads? | Allowlisted download link clicked |
| `landing_link_clicked` | Which public resources are useful? | Allowlisted public link clicked. From the release with the download pages, the Download link in the content-page header reports `destination: download_page`, not `download_section`. From the release with the contact form, `destination: contact` is a Contact link to `/contact`, and the X link reports `destination: x`. Before, both reported `contact` and opened X. From the release with the OpenBot for Teams section, its Contact us button reports `placement: teams_section`. From the release with the For Teams page, a link to `/teams` reports `destination: teams`, and a link inside that page reports `placement: teams_page`. From the release with the pricing page, a link to `/pricing` reports `destination: pricing`, and a link inside that page reports `placement: pricing_page` |
| `landing_download_selected` | Does the offered platform match the one taken? | The hero reports its detected platform once, then each manual change; `detected` separates the two |
| `content_article_opened` | Which news article or guide does a reader choose, and from where? | A link to a published article was clicked; `placement` separates an index card from the related row |
| `content_article_read` | Is an article read or abandoned? | The body reached `start`, `half`, or `end` in the viewport, at most once each per view. It measures position, not attention, and never elapsed time |
| `join_page_action` | Does the invitation web flow reach the app? | Anonymous view, download, or app-open action |
| `account_created` | How many new accounts start, and from which source? | The account service made a new account at a verified email sign-in. `sign_in_surface` is `desktop`, `mobile` or `web`. A web sign-in can add the `first_touch_*` properties |
| `account_attributed` | Which first website visit brought an account? | The account service saved the first touch of an account for the first time. `recorded_via` is `sign_in` or `checkout`, with the `first_touch_*` properties. Sent at most once for each account |
| `billing_action` | Do accounts start, pay for, change and keep paid plans? | `action`: `checkout_started`, `checkout_returned`, `checkout_expired`, `plan_started`, `payment_succeeded`, `payment_failed`, `payment_refunded`, `refund_failed`, `payment_disputed`, `dispute_lost`, `plan_changed`, `cancel_scheduled`, `cancel_withdrawn`, `plan_ended`, or `portal_opened`, as the account service stores it. Optional `plan`, `interval`, `currency`, `amount` (minor units of `currency`, from Stripe), `recovery`, and `flow` (Portal). `plan_started` can add `reactivated` (true when every earlier plan of the account had ended); `plan_ended` adds `end_reason` (`unpaid` after a failed payment, else `canceled`). `payment_succeeded` adds the `first_touch_*` properties when the account has a first touch at that time. The refund and dispute actions add `amount_usd`, `fx_rate` and `fx_date` (the rate of the refund or dispute date) when the amount is at least 1 USD cent. `refund_failed` comes only for a refund that was sent as `payment_refunded`. From account service generation 11, `product` is `server` or `license`. A server sends `plan`; a license sends `users` (1 to 10,000) and `interval: month`. `plan_changed` adds `direction` (`up` or `down`): a license by its users, a server by its monthly amount, or by the plan order when an amount is missing. `checkout_started` can add `entry_point` with the values of `hosted_server_plans_action`; a reopened Checkout that waits for payment sends `checkout_resume`. A license lifecycle event comes once for each stored change of the license, from a webhook or from the app's request, whichever stores it first. License payments and refunds come from Stripe invoices, as for servers |
| `revenue` | How much did accounts pay for servers and licenses? | Verified paid invoices only. From account service generation 11, `product` is `server` or `license`, and a license adds `users`. `__revenue` and `amount_usd` in USD cents; `original_amount`, `original_currency`, `fx_rate`, `fx_date`, `plan`, `interval`, `payment_kind`, and optional `recovery` and `first_touch_*` properties. Zero-amount invoices do not emit revenue. |
| `billing_snapshot` | What is recurring revenue at the sample time? | Daily aggregate without a profile. `snapshot_date`, `as_of`, `reported_at`, `currency`, `mrr`, `arr`, `overdue_mrr`, `paying_accounts`, `paid_servers`, `cancellations_scheduled`, `checkout_mature_accounts`, `checkout_converted_accounts`, `checkout_pending_accounts`, `skipped_subscriptions` (subscriptions left out because Stripe has no valid data for them). From account service generation 11, `mrr`, `arr`, `overdue_mrr` and `paying_accounts` count servers only; `license_mrr`, `license_accounts` and `licensed_users` count licenses; `total_mrr` and `total_arr` count both. `skipped_subscriptions` counts both. Money is USD cents. Never sum snapshots across days. |
| `hosted_server_action` | Do paid hosted servers start, stay in use and come back? | `action`: `provisioned`, `setup_failed`, `idle_stopped`, `woken`, `resized`, `plan_stopped`, `renewed`, or `deleted`, when the account service changes the server. Optional `plan`, `size`, `reason` (`message`, `restart`, `schedule` or `retention`) and `error` (an allowlisted hosted server error code) |
| `email_sent` | How much of the hourly quota of the SMTP mailbox (500 messages) does the account service use? | One event for each message that the account service tries to send by SMTP from `hello@openbot.run`, after its retries. The webhook delivery does not use the mailbox and sends none. `kind`: `sign_in_code`, `team_invite`, `contact`, or `welcome`. `result`: `accepted`; `rate_limited` (the mail server refused it for its sender limit); `unknown` (the send stopped after the server may have taken the message); or `failed` (also a message that a check stopped before the connection). Count `accepted` and `unknown` against the quota. No `profileId`, address, name or content |

## Privacy and runtime validation

Payloads are validated at runtime as well as by TypeScript. String enums are allowlisted, model and
version values use bounded safe formats, arrays are filtered and capped, and numeric values reject
non-finite, negative, or implausibly large inputs. Failure codes are static and allowlisted.

Never send message content, prompts, answers, generated content, search terms, URLs (a website is
reported only as its registrable domain), referrers, user-authored names such as a custom MCP server,
routine or skill name, file names, local paths, commands, credentials and API tokens, invitation
values, raw errors, or local identifiers. Model token counts are numbers, not credentials or
identifiers, and can be sent.
Website events use only the fixed paths `/`, `/join`, `/news`, and `/guides`, or the
path of an article published in `src/lib/news.ts` or `src/lib/guides.ts`. Article slugs are an
editor-authored closed set, not visitor input: `safeScreenPath` and the `slug` property check look
the slug up in those registries, and a path or slug that is not there reports `/` or is dropped
rather than passed through. Paths are followed by the allowlisted campaign tags `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, and
`utm_term`. `landingCampaignPath` lowercases each tag and accepts at most 64 characters from
`[a-z0-9._-]`; a value outside that shape is dropped, not shortened, and no other query parameter or
hash is ever included. Session replay and automatic interaction capture remain disabled.

To check the desktop send paths, start the dev app with
`OPENBOT_ANALYTICS_CAPTURE_URL=http://localhost:47321 bun run dev`, then run
`bun run test:analytics-redaction -- --allow-mutations`. The app sends its analytics and failure
reports to that local capture server instead of OpenPanel. The script seeds a secret marker into an
agent, an MCP server, a routine and browser addresses, and checks that no captured request holds it.
It writes `.openbot-build/analytics-redaction-e2e/report.json`. A packaged build ignores the setting,
and only a loopback `http:` origin is accepted.

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
6. Token usage: the sum of `total_tokens` and of each count on `system_token_usage`
   (`surface = desktop_host`, generation 9 and later), by provider, model, `agent_source`, `agent_listing`,
   `origin`, and day. Use `system_turn_completed` for totals per turn, and show the count of
   `token_usage = unknown` turns as its own value, not as 0. Claude counts from `app_version`
   0.47.1 and earlier are too high: the first turn after a Claude process resumed a session counted
   the whole session again. Leave out `provider = claude` rows from those versions, or show them
   apart.
7. Monetization funnel: `hosted_server_upsell` `see_plans` → `hosted_server_plans_action` `viewed`
   → `plan_selected` → account service `checkout_started` → `plan_started`, by `entry_point`. Add
   `limit_reached` by `kind` and `action`, and `sales_contact_clicked` by `entry_point`. Client
   steps use `surface` `desktop`, `web` and `mobile` at their current generations; the checkout
   steps use `account_api` generation 11 and later.
8. Licenses: `license_action` steps against account service `billing_action` with
   `product = license` (`checkout_started`, `plan_started`, `plan_changed` by `direction`,
   `cancel_scheduled`, `plan_ended`), license `revenue`, and the license fields of `billing_snapshot`.
9. Activation steps: `onboarding_step` `viewed` per `step` over the first step, by `path` and
   surface, then `onboarding_completed`, `provider_action` `connect_completed` by `method`, and the
   first `message_send`.
10. Dev: `email_sent` with `result` `accepted` or `unknown` per hour by `kind`, against the
    500-message hourly limit of the mailbox, and all results per hour by `result`. OpenPanel counts clock hours, but the mail server counts
    the last 60 minutes, so two hours below the limit can still go above it together.

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

## First-touch attribution

A campaign session ends before most visitors make an account or pay. To link a payment to its first
visit, the website saves the first visit of each browser and the account service keeps it on the
account.

1. A production website page saves `openbot.first-touch.v1` in the browser's `localStorage` once:
   the `acquisition_source`, the `source_platform`, the first screen path, the UTC day, and the
   allowlisted campaign tags of that visit. A later visit does not replace it. After 90 days it is not
   read, and the next visit replaces it.
2. A sign-in in the web client (`/app`) sends it with the email code. A desktop checkout returns to
   `/billing/return?checkout=<Checkout Session ID>`, and that page sends it with the session ID. The
   account service accepts the session ID only for a checkout that it saved in the last 24 hours.
3. The account service checks every value again, saves the first value it gets for an account in the
   D1 table `account_attribution`, and sends `account_attributed`. It never replaces a saved value.
4. Later `payment_succeeded` and `revenue` events copy the saved value as `first_touch_*`
   properties.

The `first_touch_*` properties are `first_touch_source`, `first_touch_platform`,
`first_touch_landing_page`, `first_touch_date`, and the optional `first_touch_utm_source`,
`first_touch_utm_medium`, `first_touch_utm_campaign`, `first_touch_utm_content`, and
`first_touch_utm_term`. They use the same allowlists as the website properties.

Limits:

- A desktop or mobile sign-in has no browser storage, so it has no first touch until a desktop
  checkout return page sends one. The phone app does not send one.
- A browser that blocks storage, or a visitor who signs up in a different browser, gives no first
  touch.
- The first payment can be processed before the checkout return page sends the first touch. Then that
  `payment_succeeded` and `revenue` have no `first_touch_*` properties. Use `account_attributed`,
  which has the same `profileId`, to join them.
- An account made before generation 10 gets a first touch only at a later web sign-in or desktop
  checkout, and that visit can be later than its real first visit.

## Business metric mapping

The reporting team asked for these metrics. The events keep their released names; this table gives
the OpenPanel event and filter for each one. `user_id` is always the OpenPanel `profileId`, which is
the OpenBot account ID. Filter each row by its `surface` and that surface's current
`event_schema_version`.

| Metric | OpenPanel event and filter | Notes |
|---|---|---|
| `page_view` | `screen_view`, `surface = landing` | OpenPanel adds the session, the referrer and the entry page. The path carries the allowlisted `utm_*` tags |
| UTM, referrer, landing page | Session properties of `screen_view`; `acquisition_source` and `source_platform` on landing events | Session-scoped. For an account, use `first_touch_*` |
| `account_created` / `sign_up` | `account_created`, `surface = account_api` | `sign_in_surface` names the app |
| Sign in | `account_sign_in_completed`, `result = succeeded` | Desktop, and mobile from generation 3. The web app does not send it |
| `onboarding_completed` | `onboarding_completed`, `surface = desktop` or `mobile` | `preferred_provider` and `path` on desktop; `skipped` on both. `onboarding_step` gives the steps |
| First value action | First `system_turn_completed` with `origin = user` and `status = completed` for a `profileId` | The product metric |
| Engagement work | `system_turn_completed`, `origin = user` | `status` gives success or failure |
| `agent_action` | `agent_action` | `result` is `succeeded` or `failed`; `failure_code` on failure |
| Trial started | None | OpenBot has no trial period |
| Checkout started | `billing_action`, `action = checkout_started` | `product` is `server` or `license`; `entry_point` names where the plans were opened |
| `subscription_started` | `billing_action`, `action = plan_started` | `reactivated = true` is a return after churn |
| `subscription_canceled` | `billing_action`, `action = cancel_scheduled` | The plan stays open to the end of the period. `cancel_withdrawn` reverses it |
| `subscription_expired` | `billing_action`, `action = plan_ended` | `end_reason` is `canceled` or `unpaid` |
| `subscription_reactivated` | `billing_action`, `action = plan_started`, `reactivated = true` | |
| `payment_succeeded` | `billing_action`, `action = payment_succeeded` | Minor units of `currency` |
| Revenue | `revenue` | `__revenue` in USD cents, with `plan`, `interval`, `payment_kind` and `original_currency` |
| Payment failed | `billing_action`, `action = payment_failed` | |
| Refund | `billing_action`, `action = payment_refunded` | `amount_usd` in USD cents. A later `refund_failed` gives the same amount back. A refund that fails first sends neither |
| Chargeback | `billing_action`, `action = payment_disputed`; `dispute_lost` when the bank keeps the money | Only `dispute_lost` and `payment_refunded` reduce revenue |
| Net revenue | `revenue` minus `amount_usd` of `payment_refunded` and `dispute_lost`, plus `refund_failed` | `revenue` itself is never negative |
| Attribution to payment | `account_attributed` joined on `profileId` to `revenue`, or `first_touch_*` on `revenue` | See "First-touch attribution" |

## Quality checks

- Anonymous SDK requests must not contain `profileId` after any account was identified.
- Every identified profile request contains the central account ID and normalized email.
- Website `screen_view` events contain only an allowlisted path and allowlisted campaign tags, never
  an invitation query or a hash.
- A campaign link produces a session whose `utm_source`, `utm_medium`, and `utm_campaign` match the
  link, instead of `Direct / Not set`.
- A duplicate host turn start produces one `system_turn_started` event.
- A routine run or tool use replayed from history after a restart produces no event. A workflow run
  that started before a restart and ends after it produces no event.
- A known stored turn origin wins over a completion payload whose origin is `unknown`.
- `system_turn_completed` never exceeds starts for the same reporting window without a documented
  process restart boundary.
- Provider conversion uses `connect_completed`, never resolution of the initial connect IPC.
- An update status with phase `error` or `unsupported` is a failed action.
- Dashboard counts and profile assignment are smoke-tested after each analytics schema deployment.
- A new web sign-in after a campaign visit produces one `account_created` and one
  `account_attributed` with the same `first_touch_utm_campaign`. A second sign-in produces neither.

## Reliable error reports

The three failure events above use a separate local queue and explicit HTTP transport. Other
product events keep their existing delivery behavior. Only production clients collect reports.
The browser app uses `surface: web` and `platform: web`; it enables collection only on
`https://openbot.run`. Each surface accepts a report up to its current generation, so a report from
an earlier generation that is still in the queue is sent. Marketing remains `landing` and does not send app notification events.

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

Live project access, dashboard creation, and production delivery must be verified after
deployment.
