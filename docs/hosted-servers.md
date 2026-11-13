# Hosted servers

A hosted server is an OpenBot server that runs in a [boat](https://boat.dev) sandbox, so it works
when the user's computer is off. Each server is one boat sandbox for one account. The sandbox runs
the Linux build of OpenBot on the boat desktop. The server runs while it is in use. After 15 minutes with no
use, the Worker stops it and keeps its data. The next client starts it again, the Worker cron
starts it before its next routine run, and Signal starts it for a Slack, Discord or Telegram message
that addresses OpenBot (see [Connector events](#connector-events)). A connected client counts as use for 5 minutes after its
last user action (`CLIENT_USE_WINDOW_MS`): a request that changes data, or a typing event. Reads and
the requests that a client sends with no user action (polls, previews, mark-read) do not count
(`src/main/team-api/client-use.ts`). An app that has focus (a focused desktop window, a visible and
focused browser tab, the phone app in the foreground) also counts, for at most 30 minutes after the
last user action of its session or after the app gets focus again (`focus-use-v1`). So an app that has focus but is not used keeps the
server on for 30 minutes, and then the server stops 15 to 30 minutes later. An app that is open
without focus does not keep the server on: it stops 15 to 30 minutes after the last action (see the
cron interval below). The desktop and the web client then show the server as asleep, and the next key
press or click wakes it.

To run the same build on your own computer, see [self-hosted servers](self-hosted-server.md). It
uses the scripts and units of this page with `mode` set to `self`.

The Worker enables hosted servers only when it has the boat and Stripe secrets and
`HOSTED_SERVER_TEMPLATE`, and only for the account IDs or emails in `HOSTED_SERVERS_ALLOWED_USER_IDS` (`*`
allows each account; with no value, no account can create a server). Production sets `*` in
`wrangler.jsonc`, so each account can buy a server. See [Production](#production). An account can have 50 servers that are not
deleted (`MAX_SERVERS_PER_ACCOUNT`). An account has at most one server that waits for its first
payment: a create with a new Idempotency-Key gives its plan to that server and opens a new page. So a
cancelled or abandoned Checkout page adds no server, also when the client lost its key (the web client
leaves the page for Stripe). The old page closes first; when the user paid on it, the create returns
that server with no page. The server list sends the limit as
`maxServers`. When the paid servers reach it, the add server dialog disables the plans and opens the
server list (Settings on desktop, Billing on the web) to delete a server. Each server
has its own Stripe plan. Its machine comes from the plan
(`HOSTED_PLAN_SIZE`): Starter is boat `small`, Standard is `default`, and Pro is `large`.

## Parts

| Part | Where | Job |
| --- | --- | --- |
| Account Worker | `apps/auth-api/src/server/hosted-server-service.ts`, `boat-client.ts` | Creates, restarts and deletes sandboxes. Stores state in D1 (`0023_hosted_servers.sql`, `0028_hosted_server_lifecycle.sql`). |
| Server template | `scripts/hosting/` | Builds the boat named snapshot that each server starts from. |
| Server bootstrap | `src/main/hosted-server-bootstrap.ts` | On the first start, redeems the claim, signs in, and publishes the host. |
| Start retry | `src/main/hosted-server-start-retry.ts` | Publishes the host again after a failed start. |
| Activity report | `src/main/hosted-server-activity.ts` | Tells the Worker that the server is in use, and when its next routine runs. |
| Memory guard | `src/main/server-memory.ts`, `src/backend/agent/memory-hold.ts`, `turn-slots.ts` | Reads the memory of the server, holds new turns when it is low, and limits the turns that run at the same time. See [Memory](#memory). |
| Billing link | `apps/auth-api/src/server/hosted-billing.ts`, `billing-service.ts` | Opens Stripe Checkout for a new server. Tells the hosting service when a subscription changes. |
| Desktop and web clients | `AddServerOverlay`, `SettingsHostedServersTab`, `hosted-server-service.ts`, `web-hosted-servers.ts`, `web-hosted-server-wake.ts` | Pick a plan, pay, list, start, renew and delete. The web app shows the list in Billing. Start a stopped server when a connection fails. |
| Mobile client | `mobile-workspace-context.tsx` | Starts the selected stopped server when a connection fails. |
| Shared wake logic | `packages/team-client/src/hosted-server-wake.ts` | The web and mobile clients use it to ask for a wake and to limit the reconnects. |

## Lifecycle

States: `awaiting_payment → creating → starting → running`; `running → stopping → stopped → waking → running`
when a server is idle or boat stops a sandbox; and `error` and `deleted`. The Worker stores what it wants (`desired_state`) and what boat reports
(`observed_state`). boat webhooks and the cron update `observed_state`.

1. **Create.** The rail plus button opens the add server dialog when the account can create hosted
   servers; otherwise it opens the join dialog. A plan sends `POST /v2/hosting/servers/` with
   `{name, plan, interval, currency}` and an `Idempotency-Key`. The Worker stores a row in
   `awaiting_payment` with no claim and no sandbox, makes the Stripe customer, and returns a Stripe
   Checkout URL (35 minutes). A repeated request expires the old Checkout and returns a new one.
   An optional `license: {tier, users}` adds the commercial license at the bundle price to the same
   page, so one payment buys both. The first sync moves the license to its own subscription that
   renews on the same day as the server ([Commercial license](architecture/servers.md#commercial-license)).
   While the license promotion (`LICENSE_TRIAL_END`) runs, the page has the server line only, and the
   license starts with a free trial until the promotion ends.
   Refunds are by email only: email licenses@openbot.run within 24 hours of the first payment for a
   refund less a €3 / $3.60 / 13.20 zł fee, once per account. There are no refunds for later changes.
   The desktop main process opens the URL only when it is an `https://checkout.stripe.com` URL; the
   renderer never gets it. The web client goes to the page in the same tab, and Stripe returns to
   `/app?hosting=checkout&hosted_server=<id>` (`&cancelled=1` when the user went back).
   `POST /v2/hosting/servers/:id/checkout` makes a new page for "Open the payment page again".
2. **Provision.** The signed Stripe webhook syncs the subscription to D1 and calls
   `onSubscriptionSynced`. When the plan is open and the row waits for payment, the Worker makes
   the host ID claim (1 hour; it stores only the hash) and creates the sandbox from
   `HOSTED_SERVER_TEMPLATE` with `noEnv: true`, so no operator secret or repository goes into the
   sandbox. The sandbox env holds only `OPENBOT_HOSTED_HOST_ID` and `OPENBOT_HOSTED_CLAIM`. The cron
   provisions a paid row when the webhook call failed, and deletes an unpaid row after 24 hours
   (it has no sandbox, so no data is lost). Before that delete it closes the Checkout; a Checkout
   that is paid keeps the row for the webhook. A row that stays in `creating` with no sandbox for 10
   minutes (the Worker stopped during the create call) goes to `error`, and the setup retry below
   applies. When that create call returns later, the Worker deletes the sandbox that no row owns.

   When the pool of the operator has a ready machine for the plan, the Worker makes no sandbox: the
   server starts on that machine ([A new server on a pool machine](#a-new-server-on-a-pool-machine)),
   and steps 3 and 5 to 8 of boat (the setup script, the stop and the resume) do not apply to it.

   The Worker then names the sandbox `openbot-<plan>-<owner email>-<first 8 characters of the host
   ID>` (`PATCH /sandboxes/:id`), so an operator can find it in the boat dashboard. The email is in
   lowercase, and each group of characters that are not letters or digits becomes one `-`. The name is only a label; a plan change
   renames the sandbox.
3. **Env handoff.** boat puts the sandbox env in the setup script, not in systemd. The Worker sends
   `setupScript: exec /opt/OpenBot/hosted/openbot-hosted-env`. That helper writes the two values to
   `~/.config/openbot-hosted/env` (mode 0600). `openbot.service` waits for this file.
4. **First boot.** OpenBot starts with `OPENBOT_HOSTED_SERVER=1`. It redeems the claim at
   `POST /v2/hosting/claims/redeem`, signs in as the owner, keeps the host ID, and publishes the
   host. `registerHost` refuses the host ID for any other account. This claim is not the operator's
   [server claim](self-hosted-server.md#sign-in-with-a-server-claim) of a self-hosted server.
5. **In use.** OpenBot checks each minute whether the server is in use: an agent works, a remote
   desktop view is open, a file moves, or a remote client is connected (an open Team API event
   stream) and sent a user action, a typing event or a focus ping in the last 5 minutes. A key press or pointer
   input in a browser view is a user action. An open browser view with no input does not count,
   because a view that the user forgot would keep the server on.

   **Focus.** Only a hosted server advertises `focus-use-v1`. While the app of a client has focus and
   the server is online, the client sends `POST /v1/client/focus` with an empty body at once and then
   each 4 minutes (`FOCUS_USE_INTERVAL_MS`): the desktop for its selected server while the window has
   focus, the web client for its server while the tab is visible and has focus, and the mobile app for
   its selected server while it is in the foreground. The host counts a ping as use only for 30 minutes
   (`FOCUS_USE_LIMIT_MS`) after the later of the start of the focus period and the last user action of
   the same session. A ping more than 8 minutes after the previous one starts a new focus period. The
   ping is passive in `client-use.ts`, so it does not reset the limit and does not change which session
   push notifications count as in use. Like other use, a focused app delays the automatic update
   restart of a hosted server (`RequestedUpdate`, `clientInUse`).

   It sends
   `POST /v2/hosting/servers/:id/activity` with `{inUse, nextRunAt}` and the session from its claim:
   at once when the use starts, then at most each 5 minutes while the use continues, and each time
   the next routine run changes. The Worker accepts only that session, not the owner's own sessions.
   It stores `last_active_at` for a report with use, and `next_run_at` (null for a time that is not
   in the future). A report with no body is from an older server: it counts as use and keeps
   `next_run_at`. When boat reports
   `archived` for a server in use (for example, after maintenance), the webhook resumes the sandbox
   at once. The Worker cron (each minute on `test`) resumes a server that stays `stopped` for 2
   minutes.

   A live Slack, Discord or Telegram connection is not use when the last Signal said
   `ingress-queue` in `ready` and the host sent it a queue key: the server sleeps with its connectors.
   Otherwise (an older Signal, or no key) the connection counts as use, so no message is lost.

   **Idle.** The cron stops a running server with no activity and no state change for 15 minutes:
   `desired_state = 'idle'`, and boat saves the disk. It does not stop a server whose next routine
   run is less than 10 minutes away. The webhook does not resume an idle server. The next wake
   (step 6) sets it to `running` and resumes it. A start and a resume count as activity, so the first
   client has 15 minutes to connect. A client that connects with focus keeps it on for 30 minutes
   with no input.

   **Scheduled start.** The cron starts an idle server when its `next_run_at` is less than 10 minutes
   away (one cron interval and the start time), with the wake reason `schedule`. It clears
   `next_run_at` in the same update, so a server that does not report again starts only once for
   that run. After the start, OpenBot runs each routine that is due, and each run that it missed
   becomes one run.

   **Keep-alive start.** boat deletes the disk of a stopped sandbox 14 days after the stop (it
   sends an email on day 11), and a resume then fails with `snapshot_data_expired`. Each stop saves
   a new disk. The cron starts an idle server whose last use (`last_active_at`) is 10 to 14 days
   ago and keeps its `next_run_at`. The start counts as use, so with no client the idle stop comes
   15 to 25 minutes later and saves the disk again. It sends one such start in each 10 minutes of
   cron time (a tick whose UTC minute is a multiple of 10, so at most 144 each day for each Worker
   with a cron each 5 minutes or each minute), the oldest change first: the test and production
   Workers share the boat limits of 200 starts each day and 100 active sandboxes. After a
   boat fault (5xx or no answer) the server sleeps again with its last use, and a later tick tries
   again. `last_wake_reason` is `schedule` (its D1 check has no other value); the `woken` analytics
   event has the reason `retention`. A server whose plan ended (`stopped`), whose deletion is due,
   or whose disk is older than 14 days does not start: boat answers the resume of a deleted disk
   with a 409, which the Worker reads as a start in progress.

   **Lease.** boat has no idle timer, and a boat trial refuses a sandbox with no auto-stop. Each
   create and resume sends `ttlSeconds: 7200`, so boat stops a sandbox that the Worker loses. An
   activity report extends the time (`PATCH /sandboxes/:id`) when less than 1 hour is left
   (`lease_until`). When boat stops a server in use at the end of its lease, the Worker resumes it.

   **Disk save at a stop.** boat saves the disk of a running server file by file, with no pause,
   and a file that changes during its copy is restored torn. A SQLite checkpoint during the save
   gave a damaged database ("OpenBot database failed its integrity check"). Thus a hosted server
   stops OpenBot before the save. boat runs `/home/user/.boat/pre-stop` as `user` when a stop
   starts, waits for it to end (at most 60 seconds), and then saves the disk. boat supports this
   hook, but its documentation does not show it yet. `openbot-hosted-update` installs `scripts/hosting/openbot-boat-pre-stop` there
   (`install_hosting`, and `trigger` at each start, so a server that an older release updated gets
   it). The hook makes `/run/openbot-pre-stop` and runs `systemctl stop openbot.service`: OpenBot
   gets `SIGTERM`, stops its services and closes `openbot.db` last. After 40 seconds the hook kills
   the unit, which leaves a database that SQLite recovers. The file makes the unit condition
   `ConditionPathExists=!/run/openbot-pre-stop` fail, so `Restart=` and the end of an update request
   do not start OpenBot during the save. `/run` is empty at each boot. boat can also keep a stopped
   machine in memory and continue it at a resume with no boot: the resume answers `"status":
   "running"`, and the file stays. Then the Worker runs a command on the machine that removes the
   file and starts `openbot.service` (`HELD_RESUME_START_COMMAND`). With no file the command does
   nothing. boat can also cancel the stop after the hook, for example when it cannot pause a Docker
   container that restarts ("Final snapshot failed; stop aborted"). The machine then runs with the
   file, and OpenBot stays stopped. Two paths start it again, both only for a file older than 5
   minutes: boat runs the hook again before each new try of the stop, so a newer file can belong to a
   save that still runs. The hook sets a transient systemd timer (`openbot-pre-stop-restart`) that
   fires 15 minutes after the last hook. A client wake or a connector event for a server that boat
   reports as running makes the Worker run `FAILED_STOP_START_COMMAND` after the reply. boat tries
   the stop again every 4 to 10 minutes (seen on 2026-11-05), and each try stops OpenBot again. Thus
   the timer fires only after boat stops its tries, and a wake keeps OpenBot running only until the
   next try. boat reports these tries as `stop.status: "failing"` and keeps the sandbox state
   `idle`. On 2026-11-05 a save failed this way for 18 hours, while the restore of the disk stalled,
   and the start command failed with `sandbox_restoring`. Thus the Worker reads a failing stop as
   `stopping`, not `running`, and logs `Hosted server stop is failing.` at each check. A `sandbox.ready`
   webhook for a stopping server makes the Worker read the sandbox again, so the webhook does not hide
   the failing stop. Each client wake and connector event still sends `FAILED_STOP_START_COMMAND`. The Worker does not end the stop. Only a resume ends it
   (`superseded`), but boat does not say if that resume keeps the disk or restores the last saved
   disk. A forced stop keeps only the last saved disk and loses what was written after it. An
   operator decides: compare `snapshotCompletedAt` with the last writes of OpenBot before a force,
   then wake the server. A machine that stopped
   runs no timer. A hook that OpenBot did not write stays, and a self-hosted server gets
   no hook.

   **Check at a start.** `PRAGMA quick_check` reads every page of `openbot.db`: on a 15.7 GB file
   it stopped the main thread for 77 seconds to about 4 minutes. A clean close removes
   `openbot.db-wal`. Thus OpenBot runs the check at a start only when that file is there (a crash,
   a kill, or a save while OpenBot ran) or when a migration ran.
6. **Start after a failure.** A client that cannot reach the host first calls
   `GET /v2/hosting/servers/:id/status` (owner or member; 404 for a host that is not a hosted
   server). It returns `{serverId, state, error, sleeping}` and writes nothing, so it does not count
   as use. `sleeping` is true when the server stopped for no use (`desired_state = 'idle'`). Then:
   - A sleeping server stays asleep. The client shows it as asleep and calls
     `POST /v2/hosting/servers/:id/wake` on the next key press or click, or when the user selects
     the server. Without this check, an open client would wake the server each time it stops.
   - Any other server that the client cannot reach (a lease end, a crash, `error`) gets a wake at
     once. This resumes a `stopped` sandbox or one in `error`.
   - A network error gives no wake. A Worker with no status route (404 with another error code) gets
     the old wake path.

   The desktop asks for each stored hosted server when Signal answers `host_unavailable`, at most
   once a minute for each host, and wakes only the selected server while the app has focus. After a
   wake, it connects again every 5 seconds, and reads the status every 30 seconds to show the step:
   the machine starts (`waking`, `starting`, `stopping`, or `stopped` with no error, which also gets a
   wake), OpenBot starts (`running`), or the provider refused the start (`waking` with
   `provider_limit`). The client waits with no limit while the
   machine starts. When the machine is `running` and its host does not connect in 15 minutes, the
   client shows that the server did not start in time, as it does after 10 status reads in a row
   that fail. Restart is not available while the machine starts. It is available when the machine
   runs and OpenBot does not answer. The web client does the same for its one server, and checks a
   sleeping server again every 5 minutes. The mobile app has no status check: it wakes the selected server while the app is in
   the foreground, with the same limit for a `running` server. A server whose plan ended answers
   `402 plan_required`.

   **Rate limit.** When boat refuses a resume with `429`, the row stays `waking` and gets
   `observed_error = 'provider_limit'`, so clients keep waiting. The next client wake, Signal route
   wake or cron pass sends the resume again after a delay: the time from the wake
   (`provider_event_at`) to the last refusal, from 30 seconds to 5 minutes. A retry keeps the wake time
   and the error, and only one caller can claim it. A resume that boat accepts clears the error. The
   cron does not ask boat about such a row, because boat reports the sandbox `archived` and the row
   would become `stopped`. A `409` on a retry (boat already resumes the sandbox) clears the error, so
   the cron reads boat again when the webhook does not come. Any other resume failure sets `error` as
   before.

   A paid server whose setup failed has no sandbox. A wake (Retry in the add server dialog) sets
   it up again at once, and the cron does this 10 minutes after each failure. Each attempt sends
   the same request body and the same idempotency key, the host ID. The claim is an HMAC of the
   host ID with a key that the Worker derives from `REMOTE_TICKET_PRIVATE_JWK` (HKDF), so it is the
   same on each attempt and needs no secret of its own. When a failed attempt made
   a sandbox, boat returns that sandbox and the Worker stores it. A sandbox that a create returns
   after the cron gave up on that create is stored too; only a delete during the create removes it.
7. **Plan ends.** When the subscription is cancelled or unpaid, or `past_due` after its period
   end, the Worker sets `desired_state = 'stopped'` with the error `plan_ended` and stops the
   sandbox. boat saves the disk; the Worker never deletes it. "Renew plan" in Settings calls the
   checkout route: the Worker makes a new plan only when no open plan exists for the server. With
   an open, unpaid plan it answers `409 hosted_server_payment_due`, and the user pays in the Billing
   Customer Portal. When the plan is open again, the Worker resumes the sandbox. A server whose setup
   failed has no sandbox: a renewed plan sets it up again.

   After a failed renewal, Stripe moves the period end forward and retries the payment, so the
   server keeps running while the plan is `past_due`. When Stripe stops the retries, it cancels the
   plan and the server stops. This needs the Stripe setting in [Production](#production): with
   "leave the subscription past-due", Stripe moves the period end at each renewal and the server
   runs with no payment. A cancel at the period end (`cancel_at_period_end` or `cancel_at`)
   shows the end date and keeps the server running until then.

   Refunds and disputes. A full refund (`refund.created` or `refund.updated` with `succeeded`) of
   the invoice that paid the current period cancels the plan now: the account paid nothing for that
   period. That invoice is the subscription's `latest_invoice`, made for a new plan or a renewal
   (`billing_reason` `subscription_create` or `subscription_cycle`). Partial refunds that add up to
   the full amount count as a full refund (the charge is `refunded`). A partial refund, or a refund of
   an earlier invoice or of a plan change, keeps the plan and the server. After a plan change in the
   period, `latest_invoice` is the plan change invoice, so a refund of the renewal keeps the plan too.
   To end the plan in these cases, cancel the subscription in the Stripe Dashboard. A dispute
   (`charge.dispute.created`, an inquiry too) cancels the plan of the disputed invoice now, so Stripe
   does not charge that card again. In both cases
   the server stops with `plan_ended` and keeps its disk. The Worker finds the plan through the
   invoice of the PaymentIntent (`GET /v1/invoice_payments`). A refund or dispute of a payment that
   is not an OpenBot plan invoice changes nothing. A refund that fails after it succeeded does not
   start the plan again.
8. **Plan change.** In the Customer Portal an upgrade is charged at once, and a downgrade or a
   shorter interval starts at the next period. The Worker copies the new plan, interval and currency
   to the server. boat changes the machine of a sandbox only on a resume (`type`), so the Worker
   stops a running server (boat saves the disk) and resumes it on the machine of the new plan. The
   server is offline for this time, so the Worker waits until the server has no use: no activity
   report for 7 minutes (a server in use reports each 5 minutes). A server that stops for no use,
   or that was not running at the plan change, gets the new machine at its next resume. When the data does not fit a smaller machine, boat refuses it
   (`409 type_too_small`); the server then starts on its old machine, and the Worker does not try
   again until the next plan change.
9. **Restart.** The owner or an admin selects Restart server in the server menu, above Leave or
   Delete. The account host list (`GET /v2/remote/hosts/`) marks each hosted server with
   `hosted: true` while its plan is active, so the clients of an admin know where to show it.
   `POST /v2/hosting/servers/:id/restart` (the owner, or an active admin membership) moves a
   `running` row to `stopping` and stops the sandbox. The `archived` webhook (or the cron) then
   resumes it with the wake reason `restart`. A row in any other state gets a wake. boat answers `409` when the sandbox is busy; the Worker
   puts the row back to `running` and answers `409 hosted_server_restart_busy`. The Worker uses stop
   and resume because the production boat key has no command access. The clients connect again as
   after a wake: a wake reply of `stopping` now also starts the reconnects.
10. **Delete.** `DELETE /v2/hosting/servers/:id` with `{confirmName}`. The Worker first closes the
   open Checkout page. When the user paid on it just now, the Worker keeps the server and answers
   `409 hosted_server_paid`, so the owner sees the server before a second delete cancels the plan.
   Then it cancels the open plan now, with no refund. A Stripe failure stops the delete (502), so
   the user does not pay for a deleted server. Then it deletes the sandbox and its Remote host. The D1 row stays with `desired_state = 'deleted'`, so a sandbox is never
   left without a record.

## Providers

OpenBot ships no AI subscription, so a new server has no provider connected. When its owner or an
admin opens a server with no agent, the app shows a provider step before the first-agent form. The
sandbox browser is on Xvfb, where nobody can see it, so each sign-in finishes on the user's own device
over `providers-v3` and `providers-v4`: Codex, Grok and Cline show a device code, Claude shows a page
whose code the user pastes back into the app, and Cursor shows a page that signs the host's CLI in by
itself. The Claude sign-in runs under `script` from util-linux (package
`bsdutils`, in every Ubuntu and Debian image). See
[Admin capabilities](architecture/servers.md#admin-capabilities) for the routes. Before you sign in
a Claude subscription on a server, read [provider terms](provider-terms.md#claude).

## Members

The plan sets the number of active members, owner included: Starter 1, Standard 5 and Pro 10
(`BILLING_PLANS`). A host with no plan, such as a self-hosted server, takes the users of its owner's
license (`ownerLicenseForHost`): Starter 1, Team 2 to 10. Only a license that is `active`, `trialing`, or
`past_due` until the end of its period gives these seats. A host with no plan and no such license has 3
(`DEFAULT_TEAM_MEMBER_LIMIT`). The Worker reads the limit in this order: a `server_member_limits` row,
a hosted plan, the license, the default. A self-hosted host can keep a plan from before the license; it
takes the larger of that plan and the license users. When an account has two open licenses, an
entitled one comes first. When the limit comes from the license, a full server refuses a
join with `409 license_users_full`. When a license ends, its servers go back to 3; members who are
active stay. Any open license, also an `unpaid` one, refuses a join after its users, so the host list
shows the lower of the limit and those users. When a license opens or closes, changes its users, or
starts or stops giving them, the Worker sends `account-servers-changed` to each active member of the
owner's servers, so their devices read the new limit. A renewal sends nothing. A `past_due` license that
passes its period end sends it when the lapse sweep reads the license. A server made before
these limits keeps the old limits of `LEGACY_MEMBER_LIMITS`: Starter 3, Standard 10 and Pro 25.
Migration `0041` sets `hosted_servers.legacy_member_limits` to 1 for each existing row, and the
Worker writes 0 for a new server. A self-hosted host with a plan has no hosted row, so it also keeps
the old limits. `getServerEntitlement` returns the
limit as `memberLimit`. The Worker reads the plan
with `getServerEntitlement` when a member joins or is reactivated, and refuses a member over the limit
(`409 member_limit_reached`). A lower limit removes no member who is already active. This also applies to a
self-hosted host that has a plan.

- A row in the D1 table `server_member_limits` replaces the plan's limit for one server, such as an
  enterprise customer's, from 1 to 100. The row names the account that owns the server and applies
  only while that account owns it, as a plan does. The key is the server ID, so the row stays when
  the owner deletes the host and registers it again; it stops when the account is deleted. No route
  writes it; add, change or delete it by hand (`openbot-auth-test` for the test Worker):

  ```sh
  bunx wrangler d1 execute openbot-auth --cwd apps/auth-api --remote --command \
    "INSERT INTO server_member_limits(server_id, owner_user_id, member_limit, created_at, updated_at)
     SELECT host_id, owner_user_id, 50, unixepoch() * 1000, unixepoch() * 1000
       FROM remote_hosts WHERE host_id = '<server id>'
     ON CONFLICT(server_id) DO UPDATE SET owner_user_id = excluded.owner_user_id,
       member_limit = excluded.member_limit, updated_at = excluded.updated_at"
  ```

  For a hosted server that has not published its host, read the owner from `hosted_servers`. Delete
  the row to go back to the plan's limit. Clients see the new limit when they read the host list
  again.
- A lower limit after a plan change, a plan end or a custom limit removes no one. Active members
  keep their seats. A new join or a reactivation waits for a free seat.
- The host list (`GET /v2/remote/hosts/`) gives `memberLimit` for each host. The desktop, web and
  mobile member screens show it. They use 3 when an older Worker sends no limit.
- After each subscription sync, the Worker sends `account-servers-changed` to each active member,
  so their devices read the host list, and the new limit, again.
- A host that is not on an account keeps 3 in its own store (`src/main/team-store.ts`). It has no plan.

## Configure the test Worker

`HOSTED_SERVERS_ENABLED` is `true` in `env.test` of `apps/auth-api/wrangler.jsonc`.
`bun run api:deploy:test` loads `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `BOAT_API_KEY` and
`BOAT_WEBHOOK_SECRET` from the encrypted `apps/auth-api/.env.dev` on each deploy, so a
value that you set by hand for these four is replaced. Set `DOTENV_PRIVATE_KEY_DEV` in the shell.
`bun run hosting:setup --target=test` makes the two webhooks and writes their secrets to that file. `api:deploy:test` also sets the allow list from
`HOSTED_SERVERS_TEST_ALLOW_LIST` in that file. Set the template with
`wrangler secret put HOSTED_SERVER_TEMPLATE --env test` from `apps/auth-api`:

| Name | Value |
| --- | --- |
| `HOSTED_SERVER_TEMPLATE` | The named snapshot from the template build, such as `openbot-server-0-9-0`. |
| `HOSTED_SERVERS_ALLOWED_USER_IDS` | Comma-separated account IDs or emails that can create servers. `api:deploy:test` sets it from `HOSTED_SERVERS_TEST_ALLOW_LIST` and refuses `*`: the test Worker is public, and it shares its boat account with production. |

The `BOAT_API_KEY` in `.env.dev` is the development key of the boat test account. It also has
command access, because the e2e script (`scripts/stripe-flows-e2e.ts`) reads the VM with it. Use it
only with test data. The production key must be a boat key limited to sandbox create, get, list,
update, stop, resume and delete. The Worker uses update (`PATCH`) for the lease and the name. Do not
give it file, command, prompt or desktop access: this key must not read user data.

The boat webhook goes to `https://<test Worker origin>/v2/hosting/boat/webhook` for
`sandbox.ready`, `sandbox.error`, `sandbox.archived` and `sandbox.hydrated`. The Worker checks the
HMAC signature, refuses a delivery older than 5 minutes, and ignores a delivery ID it has seen.

### Real servers from a development build

A local Worker does not make hosted servers: a boat VM cannot reach a Worker or a Signal service on
your computer. To get a real server, start the app with `bun run dev --hosting=test`. The app then
signs in to the test Worker, and the test Worker makes the VM. The local Worker and Signal still
start, but the app does not use them for its account. The app uses its own profile for the test
Worker, and all worktrees share it, so you sign in one time.

Each developer who has `DOTENV_PRIVATE_KEY_DEV` can create a server with any account.
The command decrypts
`HOSTED_SERVERS_DEVELOPER_KEY` from `.env.dev`, and main sends it in the
`OpenBot-Hosting-Developer-Key` header of each hosted server request. The test Worker has the same
key and lets the account create servers. A clone of the repository cannot decrypt the key. Main
removes the key from its environment at the start, so agents do not get it, and a packaged build
never sends it. To change the key, update `HOSTED_SERVERS_DEVELOPER_KEY` in `.env.dev` with a
temporary 0600 dotenvx key file containing the matching development key, remove that temporary file,
and run:

```bash
bun run hosting:setup --target=test
bun run api:deploy:test
```

`HOSTED_SERVERS_TEST_ALLOW_LIST` has the account IDs of
`bun scripts/stripe-flows-e2e.ts --print-user-ids`, so the e2e scenarios, which send no key, can
create servers. The test and production Workers use one paid boat account (plan `box_20`), so
they share its limits: 100 active sandboxes, 200 starts each day, and 2,000,000 compute seconds
each month (about 555 hours).

## Production

The production Worker has `HOSTED_SERVERS_ENABLED=true` in `wrangler.jsonc`. Nothing starts until
the secrets below are set. Set `HOSTED_SERVERS_ENABLED` to `false` to stop new servers; existing
servers, their webhooks and the cron continue.

1. **boat.** Use a paid boat account: a trial allows 2 sandboxes and only `small` and `default`, so
   Pro (`large`) fails. Make the Worker key with the scope in the table above. Turn on auto-pay in
   the boat billing page: when the balance is empty for 24 hours, boat snapshots and stops each
   running sandbox, including paid servers. boat charges only while a sandbox runs, per second:
   `small` $0.018, `default` $0.036 and `large` $0.072 each hour (see
   [boat pricing](https://docs.boat.dev/pricing)). `GET /limits` shows the balance in `default`
   seconds.
2. **Template.** Configure the [hosted release job](RELEASING.md#hosted-server-snapshots).
   Each stable desktop release builds and selects a production snapshot. Existing servers keep
   their data and use their own [update process](#updates).
3. **Webhooks and secrets.** Put the live Stripe key and the Worker boat key in the shell, so they
   are not in the history, and run the setup with `gh` signed in:

   ```sh
   read -rs STRIPE_SECRET_KEY && read -rs BOAT_API_KEY && export STRIPE_SECRET_KEY BOAT_API_KEY
   bun run hosting:setup --target=production
   ```

   It makes the six Prices, the Customer Portal settings, the Stripe webhook endpoint and the boat
   webhook. It writes the two keys and the two webhook signing secrets to the `cloudflare-production` GitHub Environment. Run it again at any time: it keeps
   a secret that the Environment has. `--replace-webhooks` makes new signing secrets.
   Run it again after a deploy that adds an event to `BILLING_WEBHOOK_EVENTS`
   (`scripts/stripe-bootstrap.ts`), not before: an older Worker records an event that it does not
   know as received, and Stripe does not send it again.
4. **Stripe Dashboard.** In live mode, in the failed-payment settings for subscriptions (Revenue
   recovery → Retries), set "If all retries for a payment fail" to cancel the subscription or to
   mark it unpaid. Both stop the server.
5. **OpenPanel.** In the production project, make a server client. Its ID and secret send the
   billing and server events in [ANALYTICS.md](../ANALYTICS.md). Only production gets them.
6. **Secrets.** The `Deploy Cloudflare production` job in `.github/workflows/ci.yml` sends these
   from the `cloudflare-production` GitHub Environment. It refuses a set with only some values and a
   Stripe key that is not live. OpenPanel credentials are required before any remote change.
   An optional value that is not set keeps the value that the Worker has; to turn
   a feature off, run `wrangler secret delete <name>`.

   | Name | Kind | Value |
   | --- | --- | --- |
   | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | secrets, a pair | Step 3 writes them |
   | `BOAT_API_KEY`, `BOAT_WEBHOOK_SECRET` | secrets, a pair | Step 3 writes them |
   | `OPENPANEL_CLIENT_ID`, `OPENPANEL_CLIENT_SECRET` | required secrets, a pair | The client from step 5 |

   The release job sets `HOSTED_SERVER_TEMPLATE` directly on the production Worker. Normal
   deployments preserve it. A GitHub variable with that name is no longer used.

   The CI deploy is the production path: `.env.production` does not have all the values that it
   needs, such as `SITE_REPORT_HASH_SECRET`. `bun run api:deploy` sends the same names from
   `.env.production` and checks them the same way.
7. **Check.** After the deploy, sign in with an allowed account, add a Starter server, pay, and
   connect from the desktop and the web client. Delete the server at the end.

The cron runs each 5 minutes in production. An idle server stops 15 to 30 minutes after its last
use (a focus ping is use only for 30 minutes after the last user action or a new focus period), and the checks that repair a missed webhook run at most 5 minutes late.

### Sales reports

The OpenPanel **Revenue and Customers** dashboard shows purchases and checkout outcomes.
Revenue comes from verified `invoice.paid` events. It includes collected tax and discounts,
before refunds and fees. Refunds and lost disputes are separate `billing_action` events with
`amount_usd` (see [ANALYTICS.md](../ANALYTICS.md)); subtract them for net revenue. Amounts use USD cents. EUR and PLN amounts use the latest available
ECB rate on or before the payment date in UTC; a refund or a dispute uses the rate of its own date, so a
full refund can leave a small USD difference. The original currency and amount stay on the event.

Daily `billing_snapshot` events show MRR and ARR. MRR includes active and overdue subscriptions,
after discounts and before tax. Annual prices are divided by 12. Overdue MRR is separate.
Do not sum snapshots across dates. Read each value with its `as_of` date.

The account service stores source facts before it accepts a payment webhook. A separate D1
ledger sends the events. A network failure or unknown delivery result becomes `uncertain`.
Check OpenPanel before retrying such an event. A repeated invoice does not create new revenue.
Checkout return, expiry, and payment failure are separate outcomes; none proves that payment occurred.

## Build the server template

The template is a boat named snapshot. The desktop release workflow builds and selects production
snapshots automatically. For a separate test template, build one from a release:

```sh
BOAT_TEMPLATE_API_KEY=... bun run hosting:template --version=0.9.0 \
  --appimage-url=https://.../OpenBot-0.9.0-x86_64.AppImage --appimage-sha256=<hex> \
  --auth-api-url=https://<test Worker origin>
```

`BOAT_TEMPLATE_API_KEY` is a different key from the Worker key: it needs sandbox, file, command and
named snapshot access. The script:

1. creates a builder sandbox with `noEnv`;
2. uploads `scripts/hosting/` and runs `provision.sh` with `sudo`. It installs the packages in
   `packages.txt` (Xvfb, D-Bus, gnome-keyring, the Electron libraries and the remote desktop runtime
   libraries), checks the AppImage SHA-256, unpacks the AppImage to `/opt/OpenBot/app`, adds an
   AppArmor profile that lets Chromium make user namespaces, and enables `openbot.service` and the
   [update](#updates) units;
3. checks the installed version, that OpenBot did not start, and that no profile or claim exists;
4. saves the builder as `openbot-server-<version>` (or `--name=<snapshot>`) and deletes the builder.

The builder never starts OpenBot, so the template has no host identity and no session. A retry
reuses a ready snapshot with the same name or waits for a save in progress. It refuses a failed
snapshot and never replaces an existing name. Automatic production releases reserve the prefix
`openbot-server-production-` to avoid test snapshots in the same account. Keep each name tied to
one release and account-service origin; do not use that production prefix for manual test builds.

The builder stops before creating an eleventh snapshot. This is our automation limit:
[boat permits additional paid snapshots](https://docs.boat.dev/api/reference/snapshots/list-named-snapshots).
Before each production build, the release job removes `openbot-server-production-` snapshots of
older releases and keeps the 3 newest releases, including the new one
([details](RELEASING.md#hosted-server-snapshots)). It never removes other names. Before removing a
test snapshot by hand, check both Workers and pending server creation records
(`provider_template`); a pending retry still needs its original snapshot. Servers already made
from a removed snapshot keep running.

### Updates

Server Settings > Updates has the same controls as on a computer that updates itself: download,
**Update when idle**, **Restart now**, automatic updates, and the switch that lets members update.
OpenBot runs as the service user from a release that root owns, so it asks root to do the work
(`src/main/hosted-update-adapter.ts`). It makes an empty file in its runtime directory:
`/run/openbot/update-stage` to download, and `/run/openbot/update-install` to install.
`openbot-update-request.path` then starts `openbot-update-request.service`, which runs
`openbot-hosted-update request` as root. That removes the file without reading it and runs `stage`.
For an install, it then stops OpenBot, runs `apply` and starts OpenBot again, also after a failure.
A request that comes during a timer download waits for it while OpenBot runs. While a request runs,
root writes the step to `/run/openbot-update.state` and changes its time every 5 seconds. OpenBot
reads each change as download progress, so the download deadline finds a request that root never
takes or that stops.

The release that an older script moves into place has these units, but that script installs only
the units it knows. So `openbot.service` runs `openbot-hosted-update trigger` as root before OpenBot
starts; it installs and starts the request units when they are missing. OpenBot offers the controls
only when `/etc/systemd/system/openbot-update-request.path` is there at its start. Otherwise, and on
hosts older than this release, the panel checks the release (`host-release-v1`) and shows the
host-managed update path. A container has no request units. A container of `docker/instances` uses
the same `HostedUpdateAdapter` with folders that the host mounts in `/var/lib/openbot-update`; see
[Updates from the app](docker.md#updates-from-the-app).

The Linux build contains `scripts/hosting/` (without the TypeScript files) in `resources/hosting`.
On a server, root runs `openbot-hosted-update`:

1. `openbot-update.timer` runs `stage` 5 to 10 minutes after each start of the timer and then
   about each 6 hours. It reads the `latest-linux.yml` (`latest-linux-arm64.yml` on arm64) of the
   latest GitHub release, the manifest that the Linux desktop updater reads. When that version is newer than the installed one, it downloads the
   AppImage, checks its SHA-512 against the manifest, unpacks it in `/var/tmp`, checks that it has
   all hosting files, installs the packages in the `packages.txt` of that release, and copies it
   to `/opt/OpenBot/staged`.
   `staged.ready` comes after the last file. OpenBot keeps running. The download and unpack use
   idle CPU and disk priority.
2. `apply` copies `staged` to `app`, and then installs the scripts, AppArmor profile and units of
   the new release. `.applying` and `staged` stay until all of this is complete, so after a stop or
   a failure the next start does it again, and `stage` does nothing until then.
   `openbot-update-apply.service` runs `boot` before `openbot.service`. `boot` runs `apply` only on
   a complete disk, or when `.applying` shows an interrupted copy. `openbot.service` does not
   require it, so it starts after a failure too: with the old release, or with a partial copy after
   a failed copy, until the next start. On a self-installed server, the new release starts at the
   next boot. A hosted server installs it itself: when the release is staged, OpenBot asks root to
   install it when idle, and when no connected client changed data or typed for 5 minutes and the
   start was 5 minutes ago. Reading is not use. Server Settings shows this wait as "other work",
   because `host-update-v1` has no reason for it. The automatic update switch of a hosted server
   is always on.

boat saves `/opt` by the paths that change, and it does not look into a directory that a rename
moves. After the next stop, such a directory is empty or has its old files. So a release gets to
`/opt` only as a copy of each file, never with `mv`. A file rename is safe. [Observed on a boat VM
with a probe; not in boat documentation.]

boat resumes a server on a machine that booted before, restores the disk lazily, and starts the
units before the restore ends. The restore takes about 3.5 minutes. `stage` waits until it ends (at
most 4 minutes), and OpenBot asks for `stage` before each install, so an install never stops
OpenBot for the restore. `boot` waits only for an interrupted copy, because OpenBot starts after
it. During a restore it skips a staged release and recovers an incomplete one.

boat starts the desktop (`lightdm`) about 8 s after the resume, and then the enabled units of
`multi-user.target` again, about 16 s after it. `openbot.service` is also wanted by
`lightdm.service`, so it starts with the desktop. The second start of `openbot-update-apply.service`
does nothing: the unit stays active (`RemainAfterExit`), and `boot` does nothing while OpenBot runs
(after a failed `boot`). [Observed on a boat VM on 2026-10-11; not in boat
documentation.]
[Not confirmed in boat documentation: the `active` and `hydration-done` files in
`/var/lib/ascii-lazy` that mark the restore. Observed on a boat VM.] `apply` never removes a staged
release that is not complete.

A server only moves to a newer version: an older OpenBot cannot open a database that a newer one
migrated. `stage` stops when it cannot read the installed version, and `provision.sh` stops when the
installed version is newer. A staged release that is no longer the latest one, for example a
withdrawn release, is removed at the next `stage` run. A server that starts before that run applies
it. A release without all of its `resources/hosting` files cannot update a server.

A server that has no updater, such as one made from a template before 0.26.0, needs one upgrade by
hand. With a boat key that has command and file access: upload `scripts/hosting/` to
`/tmp/openbot-upgrade`, run `sudo systemctl stop openbot.service`, run `sudo bash /tmp/openbot-upgrade/provision.sh user <AppImage URL> <SHA-256>
https://api.openbot.run` as a detached command, and start the service again. The data in the home
folder and in `/srv` stays.

On a server, `openbot-hosted-server` starts a D-Bus session, unlocks a gnome-keyring with a
random password for each server (so `safeStorage` can keep the account session), and runs OpenBot
with `--password-store=gnome-libsecret`. The agents use the boat desktop: the lightdm session of the
sandbox user on `:0`, with openbox. So boat's desktop viewer and OpenBot remote desktop show the same
screen, and a click moves the keyboard focus to another window. After a resume, the script waits up
to 2 minutes for that session. OpenBot shows its own windows on a 1280x800 Xvfb display that
`xvfb-run` starts. `xvfb-run` adds the key of that display to `~/.Xauthority`, which has the key of
`:0`, and lightdm keeps the other keys when it writes the file. The script names `:0` in
`OPENBOT_AGENT_DISPLAY`, so an agent's screenshot and remote desktop do not show the OpenBot window
(see [Computer Use and remote desktop](architecture/computer-use.md#agent-display-on-a-server)). With
no desktop session, the server starts two Xvfb displays, as a
[self-hosted server](self-hosted-server.md#how-it-works) does. The keyring files are in
`/srv/openbot-hosted/keyrings`:

- not in `~/.local/share/keyrings`: the boat image has a locked `default` keyring there, and a
  snapshot restore resets that folder after the service starts;
- not in `/home`: after a resume, boat serves `/home` from a FUSE mount until the disk is restored.
  On that mount, gnome-keyring does not see the new link count after its backup link. Each keyring
  write then added 16,000 to 31,000 `login.keyring.temp-*` hard links, and the next resume read
  them through the slow mount for 25 s. boat keeps changes in `/srv` (not in `/var/lib`), and `/srv`
  is on the disk before the service starts.

OpenBot redeems the claim only when `safeStorage` works. After the first redeem the claim works
for 10 more minutes, so a server whose response was lost can redeem it again; each redeem revokes the
session of the one before. After that, a session that is only in memory would leave the server
signed out after its next start.

A VM that never signed in keeps its claim in its env file. Each start of that server makes the claim
work again for one hour, so a VM that missed the first hour, or whose plan ended before it signed in,
signs in at its next start. After the 10 minutes that follow the first redeem, the Worker never
accepts the claim again, until the owner revokes the session of the server: then its next start makes
the claim work again, and the server signs in with a new session. The account device list shows the
session with the server name and `hostedServer: true`, so the owner can see which session to revoke
when its token leaks. A new `REMOTE_TICKET_PRIVATE_JWK` changes
each claim, so a VM that has no working session cannot sign in after the change; delete that server.

A start that cannot reach the account server does not use the claim. The start retry signs in
again with backoff (30 s to 10 min) and then publishes the host.

## Memory

One systemd unit holds OpenBot, its browser tabs and every agent process: one `claude` process for
each thread, one set of MCP servers for each ACP session, and one set for each loaded Codex thread.
A Starter server has 4 GB. The guards are on a hosted server, a
[self-hosted server](self-hosted-server.md#memory) and a [container](docker.md#memory); the desktop
app does not change.

The unit (`openbot.service`):

- `MemoryMax=90%`: the unit can use at most 90% of the memory, so 10% stays for the desktop, sshd
  and the boat agent. The limit counts memory only, not swap. The boat image has a 2 GB swap file,
  so a process that grows first fills the swap, and then the kernel's own OOM killer acts, not the
  one of the unit. It also picks the process with the highest value, as below.
- `OOMScoreAdjust=-500` for main. Every 5 s, main gives each process that it starts an
  `oom_score_adj` of 500. So the OOM killer picks a provider CLI, an MCP server or an agent tool
  before main. The processes of the Electron binary do not change: Chromium sets the values of its
  renderers and GPU process, and its zygotes keep -500, because a new renderer starts from them.
- `OOMPolicy=continue`: one killed agent process does not stop the unit.
- `provision.sh` adds compressed swap (zram, half of the memory) when the kernel has the module.
  A Starter server then has 3.9 GB of memory and 3.9 GB of swap: the 2 GB file on disk and 1.9 GB of
  zram. zram keeps its pages compressed in the same memory, about 3 to 1 for program memory, so it
  gives about 1.3 GB more. The unit can use all of the swap (no `MemorySwapMax`). The swap holds
  idle memory, such as hidden browser tabs. A swap limit, or a lower `MemoryMax`, gives the agents
  less memory and does not protect main more: the memory test below shows the same victim in each
  case.

The app (`ServerMemory`) reads the memory every 5 s. The free memory is the smaller of
`MemAvailable` and the free memory of the unit's cgroup (cgroup v2 `memory.max − memory.current`,
plus `inactive_file` and half of `active_file` from `memory.stat`: the kernel takes that file cache
back before the OOM killer acts. The other half of the active cache counts as used, because it can
be program code that runs). Each turn that started in the last 60 s counts 300 MB more, so routines that start together
do not all pass the check before their processes grow. A start that fails counts nothing.

| Level | When | What happens |
| --- | --- | --- |
| `ok` | Other times. After `low`, only at 256 MB above the `low` limit. | Turns start. |
| `low` | Free memory is less than 512 MB or 12% of the total. | No new turn starts; the message stays queued. The agent shows one notice in each low period. The browser opens no new tab. At each sample, a Claude thread whose background tasks sent nothing for 30 minutes closes; with normal memory, background tasks keep their thread open. |
| `critical` | Free memory is less than 256 MB or 6% of the total. | As `low`. Also, the provider threads with no turn close one time. They open again from their session at the next turn. Leftover agent processes stop (see below). |

Agent processes (`AgentProcesses` in `src/main/server-memory.ts`):

- Each provider process gets `OPENBOT_AGENT_PROCESS=1`, so every program that an agent starts has
  it too. A job that an agent detaches (`nohup`, `&`, a routine wake-up job), and the workers of a
  build whose parent the OOM killer stopped, leave main's tree: the kernel gives them to PID 1. The
  variable still finds them. Xvfb, D-Bus and the keyring start before main and do not have it.
- Every 5 s, each marked process gets an `oom_score_adj` of at least 500, also after it leaves main's
  tree, and each of its threads gets the nice value 10. Main and the Electron processes keep their
  values. The Computer Use driver and remote desktop get the OOM value as children of main, but keep
  their nice value. So a full CPU slows the agents' builds and not main or the WebRTC host. Without
  this, a build with many workers took all the CPU and memory, main stopped answering, and the
  clients lost the connection.
- At `critical`, main stops leftover processes: marked processes that are not in main's tree. It
  sends SIGTERM to the largest ones that never had a child and run for at least 5 s, until the free
  memory is 256 MB above `critical`, and one SIGKILL to each one that still runs 5 s later. A shell
  or a build that runs other programs is never stopped, and the short command that a shell runs next,
  such as a routine wake-up command, is too young to be stopped. So a detached job's shell still
  wakes the agent, with the exit status of the job: 143 when the stopped process was the shell's own
  child, else the status that the job gives. A job of one process, such as a preview server, is
  stopped. A provider and its own children are never stopped: the kernel's OOM killer decides for
  them. The log has one warning for each signal, with the pid, the short name and the memory, never
  the command line.
- `NODE_OPTIONS` of each provider process gets `--require=<resources>/agent-runtime/cpu-limit.cjs`.
  In a container or a unit with a CPU limit, `os.cpus()` lists every CPU of the host, and build tools
  such as Next.js start a worker for each (63 on a 64-CPU host). The module makes `os.cpus()` and
  `os.availableParallelism()` count only the CPUs of the cgroup limit (`cpu.max`) and of the CPU
  affinity. It changes nothing without a limit, or when `/proc` already shows the limit (LXCFS). Codex gets both variables in the
  environment of its app-server, not in each thread configuration, so its sessions are not replaced.
  The Claude Agent SDK removes `NODE_OPTIONS` from the environment of the CLI, so Claude gets it in
  the `env` of its flag settings (`--settings`), which the CLI gives to the Bash tool and its hooks.

When the level is `ok` again, each held message starts. If a file cannot be read, the level stays
`ok` and main logs one warning.

Only a fixed number of turns run at the same time, from the memory of the server: 2 up to 5 GiB,
8 up to 10 GiB, and 16 above. A turn that starts, runs, or compacts the context uses a slot. When
the slots are full, the messages wait in the queue: a message from a person starts first, then
routine runs and teammate messages, and the oldest first in each group. No turn waits for a slot
that another turn holds, because a message to a teammate ends the turn that sends it. A queued
message counts as use, so the server does not stop while messages wait.

An agent's browser tab that nobody uses for 30 minutes unloads its page and ends its renderer
process. A tab restored at start has no renderer process until it is used. The tab stays in the list with its URL, title and last preview. The next use by the agent or
a person loads the page again, without its history and page state. When memory is `low`, a tab
unloads after 5 minutes. The active tab, a popup and its opener, and a tab with a
takeover, a secret, a recording, a live view, staged uploads or sound do not unload. This also
applies to the desktop app.

## Connector events

All messaging platforms use one path in Signal (`remote/api/src/ingress-queue.ts`). When an event
comes for a route (a Slack workspace, a Discord guild or a Telegram chat) and no `ingress` socket
holds it:

1. Signal asks the Worker, signed, `POST /v2/remote/route-wake` with the route and `wake`. The Worker
   finds the host in `slack_workspace_routes`, `discord_guild_routes`, `telegram_chat_routes` or
   `webhook_routes` (a route that is not revoked), and
   answers `not_hosted`, `ended`, `sleeping` or `starting` before it starts anything, because Slack
   waits at most 3 seconds. With `wake`, the server then starts in the background (`waitUntil`) as for
   a client (`last_wake_reason = 'message'`). A plan that ended starts nothing. Signal asks at most
   once a minute for each hosted route, and once in 10 minutes for another route.
2. `wake` is true only for an event that addresses OpenBot: a Slack button press, mention, direct
   message or thread reply from a person; a Discord mention or button press; a Telegram message or
   button press.
3. For such an event and a server that starts, Signal keeps the delivery frame, sealed to the host's
   queue key (`@openbot/contracts/signal-protocol/ingress-queue`), in memory for at most 10 minutes
   (64 events and 192 KB for each host). Slack gets 200, so it does not send the event again. Because
   the start runs after the answer and can fail, Signal asks for the start again once a minute while
   the host has kept events. Signal
   cannot read a kept event, and a restart of Signal loses it. Signal also keeps the queue keys only
   in memory, and a host sends its key only in its hello. So after a restart of Signal, a server that
   sleeps still starts for an event, but Signal does not keep that event: Slack sends it again, and a
   Telegram or Discord event is lost. This is accepted: it happens only to the events that arrive
   before the host connects again. Signal keeps the keys of at most 100,000 hosts.
4. Another Slack event of a hosted server gets 200 and is dropped: the host keeps only messages that
   address OpenBot, and joins the public channels again when its connection starts.
5. When the host's socket connects again, Signal sends each kept event of the routes that the socket
   holds, in order, as `queued-delivery` with an `id`. The host opens it with its private key, handles
   it as a normal delivery, and sends `queued-delivery-ack`. Signal keeps the event until that ack, and
   sends it again on the host's next hello: the first socket can close before the host handled it. The
   transports drop an event that they already handled.

The host makes its queue key once (`src/main/ingress-queue-key.ts`, `openbot-ingress-queue-key-v1.json`
in the user data folder), encrypted by the operating system, and sends the public half in each
`ingress` hello. An older host sends no key, so Signal keeps nothing for it; a hello with no key
removes the key that Signal had. A kept delivery that arrives before its connection has started waits
up to 60 seconds for it, only while the connection can still start. When the account service does
not answer, Signal keeps nothing and does not remember the failure. Signal says `ingress-queue` only
when the account service had `/v2/remote/route-wake` when Signal started, so deploy the account
service first.

A generic webhook for a route that no socket holds also starts a hosted server that sleeps, but
Signal keeps nothing: only the host can check the webhook's signature, so Signal answers 503 at once
and the sender sends again (`docs/webhooks.md`). Because Signal cannot check the sender, two limits
apply. A webhook starts a host at most once in 30 minutes, so requests to a known route URL keep a
server awake for at most about half of the time (the idle stop is after 15 minutes). And a route that
Signal has no recent answer for asks the account service at most 60 times a minute from one address
(1/10 of `REMOTE_MAX_MESSAGES_PER_MINUTE`), and 600 times a minute from all addresses together (the
full limit), so unknown route IDs cannot flood D1. Each wake request also counts against these lookup limits. A start that fails does not count against the 30
minutes. A server that stays `starting` (a resume failed and its row stays `running`) is asked to
start again, also at most once in 30 minutes. A route of a host ID that another owner registered again does not start it. A server that
went back to sleep less than 30 minutes after a webhook started it waits for the end of the 30
minutes; senders that retry for hours, such as Shopify and Stripe, still deliver. An account service
without the `webhook` route answers 400, and Signal then starts nothing, as before.

## Tested on boat

The `boat` scenario of `scripts/stripe-flows-e2e.ts` (see `apps/auth-api/README.md`) passed on
2026-09-28 with a local Worker, the Stripe sandbox and a boat trial account. It confirmed:

- the builder user has passwordless `sudo`, and AppArmor is enabled in the boat VM;
- boat runs `setupScript` for a sandbox created from a named snapshot, and systemd starts
  `openbot.service` after a create;
- OpenBot redeems its claim, publishes the host with the server name, and signs in again from the
  stored session after a restart (`safeStorage` with gnome-keyring under Xvfb);
- a delete through the Worker removes the sandbox.

A resume test on 2026-09-28 (one sandbox with the 0.24.0 AppImage, 6 resumes, each on another
machine) confirmed that systemd starts `openbot.service` again after a resume, and that a keyring
secret in `/srv` stays. From the resume call to the OpenBot start took 7 to 34 s; the keyring start
took 40 ms. Most of the time is boat: it restores the disk and then starts the enabled units, 5 to
20 s after the sandbox is `idle`.

A wake test on 2026-10-11 (one hosted server with 0.37.0) measured, from the resume call: boat
ready at 4 s, `openbot.service` at 17 s and the host register at 22 s. A wake with a staged release
took 3 min 35 s, because `apply` waited for the restore. With the start at `lightdm`,
`openbot.service` started at 8 s and the host registered at about 20 s: Electron starts slowly from
the lazily restored disk, and the desktop session holds the display until about 12 s.

A resize test on 2026-09-28 (one plain sandbox with `noEnv`, `small → default → small`, each a stop
and a resume with `type`) confirmed that boat changes the machine in place with the same sandbox
ID (2 vCPU/4 GB, then 4 vCPU/8 GB, then 2 vCPU/4 GB). Files in `/srv` and in the home folder stayed,
and an enabled systemd unit started again after each resume. The stop took 25 to 31 s, and the
sandbox was `idle` 3 to 6 s after the resume call.

A memory test on 2026-09-30 (one `small` sandbox with `noEnv`, the scripts and the Linux AppImage of
main, and a `ServerMemory` driver in a unit with the same limits as `openbot.service`)
confirmed:

- boat VMs use cgroup v2 with the memory controller, and the unit gets `memory.max` = 90% (3.4 GiB);
- the kernel has zram. `provision.sh` adds `/dev/zram0` (1.9 GB, priority 100) in front of the
  2 GB swap file of the image, and it is active again after a stop and a resume;
- the level went `ok`, `low`, `critical` and back to `ok` while a child process grew by 64 MB/s;
- the OOM killer killed the child (`oom_score_adj` 500), not the driver (-500). The unit stayed
  active. The kill was the kernel's own (`global_oom`), after the child filled the swap, and not the
  unit limit;
- the app in hosted mode gives 500 to `cua-driver`, and keeps -500 for main.

A swap test on 2026-09-30 (one `small` sandbox, systemd 255, the zram setup of `provision.sh`, and a
child at 500 in a unit at -500 that takes 32 MB each 250 ms) compared unit limits:

| `MemoryMax` | `MemorySwapMax` | Unit swap at the kill | OOM killer |
| --- | --- | --- | --- |
| 90% | none (the unit now) | 3.7 GiB | the kernel's |
| 90% | 10% | 392 MiB | the kernel's |
| 80% | 10% | 392 MiB | the kernel's |
| 75% | 10% | 392 MiB | the unit's |

In each case the killer took the child at 500, and the unit, its other process and sshd stayed.
`MemorySwapMax` takes a percentage of all swap. The processes outside the unit use about 665 MB
(17% of the memory), so above about 75% the machine is full before the unit is. The unit's own killer
is not necessary, because the kernel's also picks the process with the highest value.

A boat trial account refuses a sandbox with no auto-stop, or a TTL longer than 2 hours
(`trial_auto_stop_required`), and the Worker shows it as `provider_billing`. The Worker sends a
2-hour lease, so it works on a trial. A probe on 2026-09-28 confirmed that
`PATCH /sandboxes/:id {ttlSeconds}` sets `archiveAfter` to the current time plus the TTL. A trial
allows only `small` and `default`, so a Pro server (`large`) needs a paid boat plan.

A durability test on 2026-10-15 (`scripts/hosting/hosted-database-durability-e2e.ts`, one hosted
sandbox) stopped the sandbox while a writer used SQLite in WAL mode in the home folder:

- with automatic checkpoints, the database came back damaged after the second stop
  (`btreeInitPage() returns error code 11`);
- with an empty WAL and only small appends at the stop, 9 checks were healthy;
- with no automatic checkpoint, the main file was not damaged, but in 3 of 6 restores the WAL
  header was torn, and SQLite ignored the full WAL. The rows of that run were lost;
- with `openbot-boat-pre-stop` for the writer unit (`--mode=pre-stop`), each of 4 stops during
  writes gave a healthy database with every committed row, and no `/run` flag after the resume.

A stop-order probe on the same day (a unit that records `SIGTERM` and writes each 200 ms) showed
that boat saves the disk while the processes run, about 3 seconds after the stop call, and sends no
`SIGTERM` before the save. A pre-stop hook that slept 20 seconds started at once after the stop
call, and the last write that the restore kept was from after the hook ended. Thus boat waits for
the hook before it saves the disk.

An install test on the same sandbox put the new `openbot-hosted-update`, `openbot.service` and hook
in place, as an older release does when it updates. At the next start, `trigger` installed the hook
as `user` with mode 0755. It did not change a current hook, kept a hook that OpenBot did not write
(a file, a link or a FIFO, with no wait), and replaced a changed OpenBot hook. At a stop of the real OpenBot, the hook
stopped `openbot.service` in 0.3 seconds and ended with 0. After the resume (a new boot ID), the
flag was gone, OpenBot ran, and `openbot.db` passed `quick_check`.

## Leaseweb VPS

The Worker orders no Leaseweb server: the operator buys each VPS and adds it to a pool. A Leaseweb VPS
runs all the time, so it has no stop and no resume. A new hosted server starts on a ready machine of
the pool, and in a boat sandbox when the pool has none
([A new server on a pool machine](#a-new-server-on-a-pool-machine)). An operator can move one hosted
server at a time from boat to a VPS; [Move a server from boat](#move-a-server-from-boat) has the
record and the steps.
For a server that never was on boat, the VPS is a [self-hosted server](self-hosted-server.md) that
an operator sets up for the customer. The customer is the owner: the server signs in with a
[server claim](self-hosted-server.md#sign-in-with-a-server-claim) for the customer's email, never
with the account of an operator. One command does all the steps below.

Before you start, you need:

- The root `.env.keys` with `DOTENV_PRIVATE_KEY_PRODUCTION`. `apps/auth-api/.env.production` then
  gives the four Leaseweb keys, `SERVER_CLAIMS_ADMIN_TOKEN` and the Cloudflare token for D1.
- An SSH key of your computer in `/root/.ssh/authorized_keys` of the core server of the operators.
- The VPS ID, the owner's email, one short word for the customer (`a-z`, `0-9`), and the server name
  that the customer sees (6 to 32 characters).

```sh
env="bunx @dotenvx/dotenvx@2.38.2 run --quiet -f apps/auth-api/.env.production -fk <root>/.env.keys --"
# 1. Find the VPS just bought: each VPS with no reference on the four accounts.
$env bun scripts/hosting/leaseweb-pool.ts free
# 2. The public keys of the operators, which the bootstrap installs.
ssh <core server> cat /root/.ssh/authorized_keys >operator-keys
# 3. See the plan, then do it.
$env bun scripts/hosting/leaseweb-pool.ts custom <VPS ID> --owner=<email> --customer=<word> \
  --name="<server name>" --keys=operator-keys
$env bun scripts/hosting/leaseweb-pool.ts custom <VPS ID> --owner=<email> --customer=<word> \
  --name="<server name>" --keys=operator-keys --apply
```

When it ends, the owner sees the server in the app, and can invite the other members.

- With no `--apply`, it only shows what it would do. It refuses a VPS with a reference, and a VPS of
  the hosted pool.
- A custom VPS never has the reference `pool-free`, and each pool step that changes a machine
  (`prepare`, `move`, and then `sync`) needs it, so the pool never uses a custom VPS. When `add` and
  `custom` take the same VPS at the same time, each one reads the reference again, and the one that
  lost stops.
- It sets the reference `custom-<NN> <customer> <email>` first, with the next number after the
  highest on all four accounts, and reads it again (see [Leaseweb references](#leaseweb-references)).
- It signs in with the root password of the Leaseweb API one time. After the bootstrap, only the
  operator keys sign in, so `--keys` must have a key of this computer.
- It makes the claim just before the install, because a claim works for 15 minutes.
- At the end it runs `leaseweb-bootstrap-e2e.ts`, which restarts the server, and then checks that
  OpenBot is online and that D1 shows the owner as the active owner of the server.
- A run that stops can run again with the same arguments: it continues with the same reference,
  does not install again when the owner is signed in, and stops when another account is signed in.
- Its output has no email and no key. The report of the checks is in
  `.openbot-build/leaseweb-bootstrap/`.

The steps of the command:

1. Order a VPS with Ubuntu 24.04 or 26.04. The order takes no SSH key and no user data. The root password
   comes from `GET /publicCloud/v1/vps/{id}/credentials`.
2. Install OpenBot with `install-server.sh` and a [server claim](self-hosted-server.md#sign-in-with-a-server-claim)
   for the customer's email.
3. Run `scripts/hosting/leaseweb-bootstrap.sh` as root, with the public keys of the operators. Each
   release also has it in `/opt/OpenBot/app/resources/hosting`.

   ```sh
   ssh root@<address> bash -s "$(ssh <core server> cat /root/.ssh/authorized_keys | base64 | tr -d '\n')" \
     <scripts/hosting/leaseweb-bootstrap.sh
   ```

4. Restart the server one time before a customer uses it. The bootstrap writes GRUB to the disk
   again, and a boot fault must show now. `leaseweb-bootstrap-e2e.ts --restart=yes` does this and
   checks the result.

The bootstrap does not restart OpenBot, and a second run gives the same state:

| Part | Result | Files |
| --- | --- | --- |
| SSH | Keys only, no forwarding. The operator keys sign in as root, and as no other user. | `/etc/ssh/sshd_config.d/00-openbot-hardening.conf`, `/etc/ssh/openbot-operator-keys/root` |
| Egress rules | The service user cannot connect to the CloudStack router (the DHCP server, which gives metadata and a reset root password to each process that asks), nor to private, link-local and multicast addresses. No user can connect to TCP port 25. | `/usr/local/sbin/openbot-egress-firewall`, `/etc/openbot/egress-router`, `openbot-egress-firewall.service`, `openbot.service.d/10-egress-firewall.conf` |
| Updates | Security updates each day. They restart neither the server nor OpenBot. Ubuntu (`needrestart`) restarts each other service that uses an updated library. | `/etc/apt/apt.conf.d/20auto-upgrades`, `52openbot-unattended`, `/etc/needrestart/conf.d/50-openbot.conf` |
| Kernel | A new kernel gets a boot entry: the bootstrap installs `grub-pc` when the image has no `update-grub`. The boot arguments of the image stay. | `/etc/default/grub.d/50-openbot.cfg` |

The rules load before the network starts, with the router of the last run, and again before each
start of OpenBot, with the router of the current DHCP lease. `openbot.service` requires the rules
unit, so OpenBot does not run without them. The rules also refuse the service user a container
network in 172.16.0.0/12 and a VPN in 100.64.0.0/10; change `PRIVATE4` in the helper for a server
that needs one. They do not filter incoming connections: a port that an agent opens on all
addresses is open to the internet.

OpenBot thus keeps its old libraries until the operator restarts the service, and the server runs
its old kernel until the operator restarts the server. Plan those restarts.

A server has three names, and each one can change later:

| Name | Command | Notes |
| --- | --- | --- |
| Leaseweb reference | `PUT /publicCloud/v1/vps/{id}` with `{"reference": "<name>"}` | At most 255 characters; `@`, `+`, a space and letters outside ASCII are kept. `GET /publicCloud/v1/vps?reference=<text>` finds each server that has the text in its reference, with no difference between capital and small letters. |
| OpenBot server name | `openbot name <name>` as the service user | 6 to 32 characters. No restart. The customer sees this name. |
| Linux hostname | `hostnamectl set-hostname <name>` | Set it before OpenBot starts, or restart OpenBot after it. |

The X authorization of the virtual display has the hostname in it. After a hostname change, a new
program of a running OpenBot cannot open the display ("Authorization required") until OpenBot
restarts.

#### Leaseweb references

The reference tells each operator and each agent which VPS has an owner. All VPS on all four
Leaseweb accounts use one scheme:

| Reference | Use | Example |
| --- | --- | --- |
| None (no reference, or an empty one) | Not used. **Only a VPS with no reference can be taken for a new use.** | |
| `pool-free` | In the hosted pool, with no server. Only `leaseweb-pool.ts` and [Move a server from boat](#move-a-server-from-boat) use it. | `pool-free` |
| `<owner email> <first 8 characters of the OpenBot server ID>` | In the hosted pool, with a hosted server. `move` sets it for a moved server, and `sync` for a server that started on the machine. | `jane@example.com 1a2b3c4d` |
| `custom-<NN> <customer> <owner email>` | A server for one customer, not in the pool. `<NN>` is the next number after the highest on all accounts; `leaseweb-pool.ts custom` sets it. `<customer>` is one word in small letters. | `custom-01 acme jane@example.com` |
| `openbot-signal-<home>` | A Signal machine (see `docs/remote-session-deployment.md`). | `openbot-signal-us` |
| `pool-test-<NN>` | A test machine of the operator. | `pool-test-01` |

To take a VPS:

1. List the VPS of each account (`LEASEWEB_API_KEY_NL`, `_DE`, `_US`, `_AU`) and select one with no
   reference in the location you need.
2. Set its reference at once, before any other work on it. Then read the VPS again: when the
   reference is not yours, another operator took it, and you select another one.
3. Never take a VPS that has a reference, also `pool-free`. A pool VPS leaves the pool only with
   `leaseweb-pool.ts remove`, by a decision of the operator. `remove` keeps the reference
   `pool-free`, so the operator then sets the new reference, or clears it with
   `{"reference": ""}` when the VPS is not used.

`leaseweb-pool.ts add` gives `pool-free` to a VPS with no reference, and refuses a VPS with another
reference. For a pool VPS, the record of the account service, not the reference, decides which VPS
is free. The email in the reference goes to Leaseweb, so `PRIVACY.md` must name that before a
customer server gets one.

A pool VPS and a custom VPS also use these names:

| Name | Value | Example |
| --- | --- | --- |
| Linux hostname | `lsw-<Leaseweb VPS ID>`; it never changes | `lsw-12728110` |
| OpenBot server name | The customer's choice | |

The operator keys are a file with one public key for each operator, in the format of
`authorized_keys`, with no options. The fixed place of the list is `/root/.ssh/authorized_keys` of
the core server of the operators: read it at each run, as the command above does, so that the same
persons have access to each server. The list is not in this repository, which is public, and not in
the bootstrap, which each release has. Only public keys go on a server: each operator keeps the
private key.

- The list replaces the list of the last run. To remove an operator, run the bootstrap with the
  shorter list on each server. A run with no list keeps the keys.
- A list with a line that is not a public key stops the run before a change.
- The keys are in a file of root, not in `/root/.ssh/authorized_keys`, so the service user and the
  agents cannot read a path that they can change. A key that an operator adds to
  `/root/.ssh/authorized_keys` by hand still works.
- An operator has root access to the files, chats and provider sessions of the customer.
- Without a list, the password session of the operator is the last SSH session.

The second way in is the Leaseweb API, which works below the operating system: `reboot`, `console`,
`resetPassword`, and `attachIso` with the `GRML` image. So the Leaseweb API key gives full access
to each server and its disk. Keep it only where the operator runs. The key of the account that
has the customer servers (Netherlands) is `LEASEWEB_API_KEY_NL` in the encrypted
`apps/auth-api/.env.production`. The deploy script does not send it to the Worker. Send it in the
`X-LSW-Auth` header:

```sh
bunx dotenvx run -f apps/auth-api/.env.production -fk <root>/.env.keys -- \
  sh -c 'curl -sS -H "X-LSW-Auth: $LEASEWEB_API_KEY_NL" "https://api.leaseweb.com/publicCloud/v1/vps?limit=50"'
```

One Leaseweb account is for one sales organization, and an API key sees only the servers of its
account: the key of the German account does not list a server in Amsterdam. The key of the German
account, which has the test VPS in Frankfurt, is `LEASEWEB_API_KEY_DE` in the same file. The keys of
the accounts that have the Signal machines are `LEASEWEB_API_KEY_US` and `LEASEWEB_API_KEY_AU`.

### A new server on a pool machine

A customer who pays gets a server at once: on a machine of the pool when one is ready, and in a boat
sandbox when none is. A server that starts on boat moves to a VPS later
([Move a server from boat](#move-a-server-from-boat)). Developer decision, 2026-11-13.

The Worker cannot connect to a machine, and it has no Leaseweb key. So the machine asks:

1. `leaseweb-pool.ts prepare <VPS ID>... --keys=<file> --apply` installs the newest OpenBot, disabled,
   on each free machine, as for a move. Then it offers the machine: it makes a random token, stores the
   SHA-256 of the token in `operator_hosts.assign_token_hash` (migration 0055), and runs
   `move-from-boat.sh offer leaseweb:<VPS ID>` on the machine with the token on standard input. `offer`
   refuses a machine that has the data of a server. It writes the token to `/etc/openbot-pool/token`
   (root only) and starts `openbot-pool-wait.service`.
2. The unit sends `POST /v2/hosting/pool/assignment` with `{hostId, token}` each 10 seconds. The Worker
   compares the hash, stores the time in `operator_hosts.seen_at` (at most one write each 60 seconds)
   and answers `{"state":"waiting"}`. A wrong token gets `401 hosted_pool_token_invalid`; the unit then
   removes the token and stops. `leaseweb-pool.ts remove` clears the token in D1, so a machine that left
   the pool gets the same answer and stops asking.
3. A machine is **ready** when it is in the pool, no server names it, it has a token, and it asked in
   the last 150 seconds (`POOL_SEEN_WITHIN_MS`).
4. At the payment, the Worker reads the ready machines with the product of the plan: `VPS01` for
   Starter, `VPS02` for Standard, `VPS03` for Pro. It never uses a larger or a smaller machine. The
   currency gives the locations (`poolLocations`): a purchase in `usd` or `brl` gets a machine in
   `WDC-02`, and one in `AMS-01` when `WDC-02` has none. A purchase in `eur` or `pln` gets only a
   machine in `AMS-01`, so that its data stays in the EU, as on boat. A machine in each other location
   gets no new server; `PRIVACY.md` names the locations, so change the two together. In a location,
   the machine that was added first comes first. One `UPDATE` writes `operator_host` and the hash of a host ID
   claim, and it changes no row when another server has the machine. So two payments in the same second
   never get one machine. After three machines that another payment took, the server starts on boat.
5. The next request of the machine gets `{"state":"assigned","serverId":…,"claim":…}`. The unit runs
   `openbot-hosted-env` as the service user with the two values (the same helper as in the boat setup
   script), enables and starts `openbot.service`, then removes the token and disables itself. The
   answer is the same until OpenBot signs in, so a machine that restarts in this step asks again.
6. OpenBot redeems the claim (`POST /v2/hosting/claims/redeem`). The Worker then sets the row to
   `running` and clears the token hash of the machine. From here the server is the same as a moved server: the tables of
   [Move a server from boat](#move-a-server-from-boat) apply, but it has no `retired_sandbox_id`, so a
   delete sends no call to boat.

The row of such a server has `operator_host`, no `provider_sandbox_id`, no `provider_template` and no
`retired_sandbox_id`. Until the sign-in it has `observed_state = 'starting'` and
`last_wake_reason = 'create'`.

When a step fails, the customer still gets a server:

| Fault | Result |
| --- | --- |
| No ready machine of the product, or the pool query fails | The Worker makes the boat sandbox in the same request, as before. |
| The machine does not start OpenBot, or OpenBot does not sign in, in 4 minutes (`POOL_START_LOST_AFTER_MS`) | The cron takes the server off the machine and makes a boat sandbox for it. The claim of the machine stops working. The machine loses its token, because its disk can have the start of a server; `status` shows it as not ready. Run `prepare --reinstall` for it. |
| The plan ends before the sign-in | The row gets `error` and no machine. A renewal sets the server up again. |
| The owner deletes the server before the sign-in | The delete is the usual one. `sync` reinstalls the machine. |

`sync` does not stop or start a server that waits for its first sign-in. For a server that started on
a machine and signed in, `sync` sets the Leaseweb reference to the owner email and the first 8
characters of the server ID. The Worker cannot do that: it has no Leaseweb key.

The operator keeps the buffer. `status` shows, for each location and product, the free machines and
how many are ready, and names each free machine that is not ready. The `hosted_pool_snapshot` event
has the same number (`ready`). After `sync` reinstalls a machine, run `prepare` for it, so that the
next customer can get it. A machine that `move` uses loses its token first: `move` stops when a new
server got the machine in that moment.

A machine of the pool is not the boat image:

- It has no agent CLI for all users (`claude`, `codex`, `pi`) and no `node`. A provider shows that
  its CLI is not downloaded, and the user downloads it in OpenBot.
- It has no Docker and no boat desktop. OpenBot uses its own virtual displays.
- It shows the storage of a moved server (25, 75 and 150 GB), which is more than the plan table of
  the pricing page.
- The clients show no restart action, and the server does not stop when it is not in use.

Measured on the test Worker with a real Leaseweb VPS 2 (smoke, 2026-11-13): `prepare` of a clean
machine takes about 3 minutes. OpenBot on the machine signed in 9 seconds after the payment, and the
server was online after 13 seconds. A start on boat took 25 seconds to the sign-in. A server whose
machine did not start OpenBot went to boat 270 seconds after the payment and signed in 15 seconds
later; the late start of OpenBot on that machine got "The server claim is invalid or used."
`prepare --reinstall` made that machine ready again in 213 seconds, and after `remove` the unit on
the machine stopped at its next question.

`bun run test:hosted-pool-assignment` checks the assignment, the request of the machine, the sign-in,
the two fallbacks to boat and a payment for two servers at the same time, on the real service with
SQLite, a fake Stripe and a fake boat.

### Move a server from boat

A move is a manual operator action on one row. The setup of a VPS can take hours, so the Worker
never waits for one. A Starter server moves to a VPS 1, a Standard server to a VPS 2 and a Pro server
to a VPS 3 (developer decisions, 2026-11-11 and 2026-11-13). Two columns of `hosted_servers`
(migration 0052) hold the record:

| Column | Value |
| --- | --- |
| `operator_host` | The machine that an operator runs for the server, such as `leaseweb:12728110`. `NULL` on each server that boat runs. A row has a machine or a sandbox, never the two, and one machine has one server. |
| `retired_sandbox_id` | The boat sandbox from before the move. The rollback and the delete use it. |

The machines of the pool are in `operator_hosts` (migration 0053). A machine of the pool that no row
of `hosted_servers` names is free. See [Reuse a pool machine](#reuse-a-pool-machine).

For a row with `operator_host`, the Worker sends no call to boat, with one exception (the delete).
It writes what it wants in `desired_state`; the operator starts and stops OpenBot on the machine and
writes `observed_state`:

| Event | The Worker | The operator |
| --- | --- | --- |
| No use for 15 minutes | Nothing. The server runs all the time. | Nothing. |
| A client or a connector event asks for a start | Nothing. | Nothing. |
| The server reports its use | Stores `last_active_at` and `next_run_at`. | Nothing. |
| The plan changes | Sets `size` at once. | Nothing: each pool server has the same size. |
| The plan ends | Sets `desired_state = 'stopped'`, `observed_error = 'plan_ended'` and `plan_ended_at`. A start request gets `402 plan_required`. | Stop `openbot.service`, then write `observed_state = 'stopped'`. Until then the server still runs. |
| The owner renews | Sets `desired_state = 'running'` and clears the error. `plan_ended_at` stays. | Start `openbot.service`, then write `observed_state = 'running'`. |
| 30 days after the plan ended, with no open subscription | Reads the subscription at Stripe, then deletes the server as the owner does. | As for a delete. |
| The owner or an admin restarts the server | Refuses with `409 hosted_server_restart_unavailable`. | Restart `openbot.service` on a request to support. |
| The owner deletes the server | Cancels the plan, deletes the sandbox in `retired_sandbox_id`, removes the Remote host, ends the session, and sets `observed_state = 'deleted'`. `operator_host` stays. | Reinstall the VPS, set its reference to `pool-free`, then set `operator_host = NULL`. |
| boat sends an event for the old sandbox | Finds no row for it. | Nothing. |

The Worker sends no message to the operator, and it connects to no machine. Run
`leaseweb-pool.ts sync` each day: it does the operator column of the table. See [Reuse a pool machine](#reuse-a-pool-machine).

Never write `desired_state = 'idle'` on such a row: the next client request changes it to `running`,
and the cron query for a server with a routine does not look at the machine.

The server on the VPS stays a hosted server (no `/opt/OpenBot/hosted/mode` file), so OpenBot signs
in, reports its use and installs updates as it did on boat. `provision.sh` installs it and does not
start it, so the data is in place before the first start. `scripts/hosting/move-from-boat.sh` does
the parts of a move that run on the two machines, as root.

`leaseweb-pool.ts move <server ID> <VPS ID> --apply` does steps 2 to 8 for one server, and writes the
time of each step and of the downtime. Before the row changes, it checks for a server that is
`running` or `idle` and a free machine of the pool with the product of the plan, and it takes the
token of the machine away, so that no new server gets it. After the
row changes and before the export, it checks the same IDs of `user` on the two machines, an OpenBot
on the machine that is not older than that of the sandbox, and an ssh from the sandbox to the machine.
When a step before the export fails, it gives the row back to the sandbox, and the customer sees no
downtime. After the export starts, it stops and names the step; then finish or roll back by
hand. It needs `BOAT_API_KEY` in the environment, from `apps/auth-api/.env.dev`:

```bash
bunx dotenvx run -f apps/auth-api/.env.production -f apps/auth-api/.env.dev -fk <root>/.env.keys -- \
  bun scripts/hosting/leaseweb-pool.ts move <server ID> <VPS ID> --keys=<operator keys> --apply
```

Tested on 2026-11-12 with the test Worker: one Standard server from a boat sandbox to a VPS 2 in
`AMS-01` (OpenBot 0.68.0). The sandbox had an npm package, an apt package, a command in `/opt`, a
crontab line, an MCP server, an Inception key and sign-in files of Claude and Codex. `prepare` of a
new VPS took 140 s. The move took 69 s, and the downtime was 49 s: the export and the copy 28 s, the
import 20 s, the start 2 s. After the move, the web client showed the old chats, the Inception agent
answered in 3 s, the MCP server listed its tools, and each command, package and crontab line was
there. A first run waited for a sandbox state that boat does not use; it stopped before the export
and gave the row back, and the server had no downtime.

The order of the steps keeps the downtime short. The work that does not need the data (the install
of OpenBot, the bootstrap, the restart and the apt packages of the customer) runs while the customer
still uses the sandbox. The downtime is the export, the copy, the import and the start. The steps:

1. Deploy the Worker with migration 0052 before the first move. An older Worker does not know the
   two columns, and it can make a new sandbox for a row that has none.
2. On the VPS, while the customer still uses the sandbox: copy `scripts/hosting` to the VPS and run
   `move-from-boat.sh prepare lsw-<VPS ID> <uid> <gid> <appimage-url> <appimage-sha256> <auth-api-url>`.
   The IDs are those of `id user` in the sandbox (1000 and 1000 in the boat image). The release is the
   one that the sandbox has, or a newer one. The command sets the hostname, makes the user `user`
   with the home `/home/user`, runs `provision.sh`, and disables `openbot.service`, so a restart does
   not start OpenBot with no data. `leaseweb-pool.ts prepare <VPS ID>... --keys=<file> --apply` does
   steps 2 and 3 on free machines before a move, with the newest release.
3. Run `leaseweb-bootstrap.sh` with the operator keys. Restart the VPS one time. A new or reinstalled
   VPS has no key of an operator: `leaseweb-pool.ts` then signs in one time with the root password of
   the Leaseweb API, through `SSH_ASKPASS`, and runs steps 2 and 3 in that session. After the
   bootstrap, the password login is off.
4. Write the row, in one statement, before the export:

   ```sql
   UPDATE hosted_servers SET operator_host = 'leaseweb:<VPS ID>', retired_sandbox_id = provider_sandbox_id,
     provider_sandbox_id = NULL, desired_state = 'running', observed_state = 'running', observed_error = NULL,
     updated_at = <now in ms>
   WHERE server_id = '<server ID>' AND provider_sandbox_id IS NOT NULL AND operator_host IS NULL
     AND plan = '<plan>' AND desired_state IN ('running', 'idle');
   ```

   `<plan>` is the plan that the machine was selected for, so a plan change in this time stops the
   move. The statement changes no row of a server whose plan ended (`stopped`) or whose delete is in
   progress (`deleted`): do not move such a server.

   From this statement, the Worker sends no call to boat for the server, and the customer still uses
   the sandbox. The order is necessary: while the row has the sandbox and `desired_state = 'running'`,
   the Worker resumes a stopped sandbox in some seconds, and a resume starts OpenBot there again. The
   Worker can also stop the sandbox for no use during the export, and the next client request then
   starts it. In each case the sandbox gets data that the archive does not have. When the sandbox is
   stopped at this step, start it at boat.

   From this statement, the Worker also does not extend the boat lease of the sandbox, and boat stops
   the sandbox at the end of the lease. Read `lease_until` of the row before the statement. A server
   in use has 1 to 2 hours. When less time is left than steps 5 to 7 need, extend the lease at boat
   first (`PATCH /sandboxes/<sandbox ID>` with `ttlSeconds`). When boat stops the sandbox during the
   export or the copy, start it at boat, delete the archive, and do step 5 again. Not confirmed: the
   lease that a start at boat by hand gives.
5. On the sandbox: `move-from-boat.sh packages`, then on the VPS `move-from-boat.sh install-packages`
   with that output on its standard input. This installs the apt packages of the customer before the
   downtime. Then on the sandbox: `move-from-boat.sh export <archive>`, or `export -`, which writes the
   archive to standard output and each message to standard error. `leaseweb-pool.ts move` sends it
   with `ssh` to a key that the sandbox makes for this move: on the VPS, that key can only run
   `cat >/root/openbot-move.tar`, and the move removes it after the export. So no archive is on the
   disk of the sandbox, and the copy has no separate step. The downtime of the customer starts here.
   The command sets `/run/openbot-pre-stop`, stops `openbot.service`, and archives, with numeric
   owners, the home of `user` and `/srv/openbot-hosted`. The home has each provider sign-in, API key,
   MCP server and CLI that OpenBot downloaded. The archive also has what the customer installed
   outside the home, and not what the boat image has (the lists at the top of the script, from image
   `c4ed68db` and `5f37c910`):
   - each directory that the customer added in `/opt`, `/usr/local` and `/usr/local/lib`, and each
     npm package for all users. A directory that programs of root read, such as
     `/usr/local/lib/systemd` or `/usr/local/lib/python3.12`, stays out, and the report names it.
   - each agent CLI of the image (`claude`, `codex`, `pi`, `cursor-agent`, `hermes`) whose sign-in
     file in the home has a sign-in. A VPS has none, and OpenBot would ask the customer to download it
     again. An empty file, a file with only `{}`, or the `.env` that the image writes for Hermes is not
     a sign-in.
   - each program in `/usr/local/bin` that the image does not have, each link there into a moved
     directory or into the home, and the crontab of `user`.
   - the names of the apt packages that the customer installed (`~/.base-apt-packages.txt` of the
     image lists those of the image).

   The move does not copy systemd units or their settings in `/etc`. When the sandbox has a unit of
   the customer (a unit file in `/etc/systemd/system` of no package, or an enabled template instance
   such as `syncthing@user`), `packages` names it and the move stops before the downtime. The server
   stays on boat. On 2026-11-12 an export failed because such a service wrote to the home during the
   archive.

   The archive also has the SHA-256 of `openbot.db`, `agent-data.db`, `login.keyring` and
   `keyring-password`, the names of the npm commands and groups of the sandbox, and the Ubuntu
   version. It does not have:
   - `/opt/OpenBot`, `~/.boat`, `~/.boatignore`, `~/.ascii`, `~/.config/ascii`, `~/.Xauthority*` and
     `~/.npm/_cacache`.
   - the cache folders in each profile of Chromium, Chrome and Brave in `~/.config` (`Cache`,
     `Code Cache`, `GPUCache`, `GrShaderCache`, `ShaderCache`, the four Dawn caches,
     `component_crx_cache` and `extensions_crx_cache`). The browser makes them again. Cookies, sign-ins
     and extensions stay.
   - when the customer has no Hermes sign-in: the Hermes of the image, `~/.hermes/tools`,
     `~/.hermes/installs`, `~/.hermes/cache`, and the commands `hermes`, `hermes-acp` and
     `hermes-agent` in `~/.local/bin` that start it. The settings, sessions and skills in `~/.hermes`
     stay.
   - Docker containers and images, and Python packages for all users: the export names them.

   `~/.cache` stays in the archive. Not all of it is cache: Poetry keeps its virtual environments
   there, and Playwright and Puppeteer keep their browsers there. The export of 2026-11-13 left out
   each entry of `~/.cache` except `ms-playwright`, for the six servers of that day.

   The export prints each moved directory with its size. When the sandbox has another image than
   these two, it says so: then make sure that no directory of the list is from the image. The
   archive holds the account session and each provider sign-in and key of the customer: copy it only
   over SSH.
6. On the VPS: `move-from-boat.sh import <archive>`. The command refuses an OpenBot that is older
   than that of the sandbox, restores the archive, and compares the four SHA-256 values. An agent
   of the customer can get root in the sandbox, and the service user has no root on the VPS. So the
   service user restores the files, and only `/home/user`, `/srv/openbot-hosted` and the moved
   directories. Root makes each moved directory new, owned by `user`; a directory that the VPS has
   already stays as it is, and the report names it. The archive cannot write a file of root, a setuid
   file of root or a device. A file that root or another user owned in the sandbox gets the service
   user as its owner. When the archive has a member that the service user cannot restore, the import
   fails. Then, as `user`, the import puts the moved commands in `~/.local/bin` (a command that is
   there already stays) and installs the crontab. When it moved an npm package and the VPS has no
   `node`, it adds `~/.local/bin/node`, which starts the Bun that OpenBot downloaded to the home: Bun
   runs a Node script when it starts with the name `node`. OpenBot downloads Bun at its first start
   and when an MCP server is on; when the sandbox had no Bun, the report says so. As root, the import
   installs the apt packages of the customer. It does not install a package that changes
   the firewall, SSH or root access, such as `docker.io` or `ufw`. At the end it names each command in
   `~/.local/bin` that cannot start here (a missing interpreter, library or link target), each apt
   package that it could not install, and each item that the export did not copy. Read the report:
   a program for Ubuntu 24.04 can fail on 26.04, such as a Python virtual environment. Delete each
   copy of the archive. When the import fails, run `move-from-boat.sh discard lsw-<VPS ID>` and then
   the import again: `discard` removes the restored data, the moved directories and the crontab (the
   apt packages stay), and it refuses a machine on which OpenBot started.

   The import also removes the parts of the boat desktop from the home: `~/.ascii` and `~/.config/ascii`
   (with the token of the desktop), their links in `~/.local/bin`, the `boat` skill of each agent, the
   `computer` MCP server of the desktop in the Claude, Codex and Pi settings, the boat blocks in the
   shell files, and the Pi MCP extension when no other MCP server uses it. On the VPS, a Pi that
   called the desktop waited for it, and its start timed out.
7. Stop the sandbox at boat. Do not start it again while the VPS runs: two hosts would have one ID.
8. On the VPS: `move-from-boat.sh start`. It refuses when the import is not complete or when
   `openbot.db` changed after the import, then enables and starts `openbot.service`. A machine with
   no display manager does not wait for the boat desktop: OpenBot uses two virtual displays at once.
   Confirm in the web client that the server is online and that an agent answers. Set the Leaseweb
   reference.
9. Keep the stopped sandbox for the rollback. A delete of the server by its owner also deletes it.

The VPS is not the same machine as the sandbox:

- The boat image has commands that npm installed for all users (`claude`, `codex` and `pnpm` on
  2026-11-11). The VPS has none. The move copies the agent CLIs that the customer signed in to, and
  `import` names each other one that is missing. A provider that used a missing command shows that
  its CLI is not downloaded, and the user downloads it in OpenBot.
- `prepare` makes only the primary group of `user`, and the VPS has no Docker. `import` names each
  group that `user` had in the sandbox (`docker` and `ascii-streaming-audio` on 2026-11-11). An
  agent of the customer that used Docker does not have it after the move.
- `provision.sh` also writes `~/.boat/pre-stop` and `~/.boatignore` on the VPS, as each update does
  on a hosted server. Nothing on the VPS reads them.
- The clients show no restart action for a moved server: the server list of the account service has
  `restartAvailable: false` for it. A client from before this field shows the action and gets the
  refusal of the Worker.
- A moved server has more storage: 25, 75 and 150 GB for Starter, Standard and Pro
  (`OPERATOR_HOST_STORAGE_GB`), not the 12, 50 and 100 GB of the plan table. The account service
  sends the number in the server list, the hosting list and the billing state from the moment of the
  row `UPDATE`, so the storage meter, the storage alerts, Billing and the plan change offer show it.
  The host reads it at its start, for the instructions of its agents. The pricing page and the order
  form keep the plan table, because a new server can start in a boat sandbox. A client or a host from
  before this number shows the plan table. A rollback gives the server the plan table again, so a
  server that used more on the VPS shows a full disk.
- The number is not a limit that the machine enforces. A host with `storage-user-files-v1` measures
  the files of its user (the home folder, `/tmp` and `/var/tmp`) with `du`, and the clients show the
  plan minus that number. A host from before that capability gets the boat count: the clients
  subtract `HOSTED_SERVER_BASE_IMAGE_GB` (22 GB) for the system from the used disk, which on a VPS
  shows about 5 to 10 GB less free space than is correct, because the system part and the reserved
  blocks of a VPS are not 22 GB. The disk has much more than the user sees:

  | Plan | Machine | Disk | User sees | Disk above that |
  | --- | --- | --- | --- | --- |
  | Starter | Leaseweb VPS 1 | 100 GB | 25 GB | about 53 GB |
  | Starter (only after a change down from Standard or Pro) | Leaseweb VPS 2 | 200 GB | 25 GB | about 153 GB |
  | Standard | Leaseweb VPS 2 | 200 GB | 75 GB | about 103 GB |
  | Pro | Leaseweb VPS 3 | 300 GB | 150 GB | about 128 GB |

  The 200 GB is from the Leaseweb API (`rootDiskSize`, 2026-11-11). The VPS 3 (8 vCPU, 24 GB,
  300 GB) is from the Leaseweb product page; no VPS 3 was bought on 2026-11-11, so its disk is not
  measured. The VPS 1 (4 vCPU, 6 GB, 100 GB, EUR 4.49 a month in AMS-01) is from the order API
  (`GET /ordering/v1/products/vps?location=AMS-01`, 2026-11-13); its disk is not measured either. The
  22 GB is from the boat servers; it is not used for a VPS host with `storage-user-files-v1`.
- Move a Pro server to a VPS 3. A plan change does not change the machine of a moved server. After a
  change to Pro, a server on a VPS 2 shows 150 GB at once and has about 28 GB of disk above that,
  until the operator moves it to a VPS 3. Nothing tells the operator about the plan change: look for
  `plan = 'pro'` rows whose machine is a VPS 2. A change up from Starter on a VPS 1 is worse: a
  Standard server shows 75 GB on a 100 GB disk. Move it to a VPS 2 soon.
- The clients show the vCPU and the memory of the boat size of the plan (2 and 4 GB, 4 and 8 GB, 8
  and 16 GB) also for a moved server. A VPS has more: the VPS 2 in FRA-01 showed 6 vCPU and 16 GiB.
- After the owner deletes the server, OpenBot still runs on the VPS with a session that is ended. It
  cannot connect, and it has the data until the operator reinstalls the machine.

Rollback, while the sandbox exists: run `systemctl disable --now openbot.service` on the VPS, so that
no restart of the VPS starts a second host. Make sure that the sandbox is stopped at boat. Then give
the row back to boat. The next client request resumes the sandbox, and the resume starts OpenBot
there. The work that the server did on the VPS is not in the sandbox.

When the export failed before the import, the sandbox still runs with OpenBot stopped and
`/run/openbot-pre-stop` set. Delete `/root/openbot-move` and the marker, and start `openbot.service`
in the sandbox. Delete `/root/openbot-move.tar` on the VPS. Then give the row back with the statement
below, but with `desired_state` and `observed_state` of before the move. On 2026-11-12 an export of
24 GB took 9 minutes; a restart timer of boat started OpenBot during it, and tar stopped the export.
The export now stops that timer.

```sql
UPDATE hosted_servers SET provider_sandbox_id = retired_sandbox_id, retired_sandbox_id = NULL,
  operator_host = NULL, desired_state = CASE WHEN desired_state = 'running' THEN 'idle' ELSE desired_state END,
  observed_state = 'stopped', updated_at = <now in ms>
WHERE server_id = '<server ID>' AND operator_host IS NOT NULL AND retired_sandbox_id IS NOT NULL
  AND desired_state != 'deleted';
```

A server whose plan ended on the VPS keeps `stopped`, so the rollback does not start it. When the
plan changed while the server ran on the VPS, the sandbox still has the machine of the old plan and
the row has the `size` of the new plan. In that case also write `pending_size = size` in the
statement, so that the resume changes the machine, as it does after a plan change on boat. Not
tested: a rollback after a plan change.

A moved server that lost its session cannot get a new claim from a client request. The operator
makes a claim of 16 to 128 characters from `A-Z a-z 0-9 _ -`, writes its SHA-256 as base64url with no
padding to `claim_token_hash` and a time at most one hour ahead to `claim_expires_at`, writes
the claim to `OPENBOT_HOSTED_CLAIM` in `/home/user/.config/openbot-hosted/env`, and restarts
`openbot.service`. The redeem ends the old session.

`bun run test:hosted-operator-host` drives the real service with a fake boat and checks each line of
the table, the claim recovery, the storage of a moved server in each list, and that the servers of
boat still stop and start. The migration has
its data fixture in `apps/auth-api/test/hosted-server-operator-host-migration.test.ts`.

Tested on 2026-11-11 with one test server, two times (test Worker, boat sandbox with 4 vCPU and
8 GB, VPS in AMS-01 with Ubuntu 26.04, OpenBot 0.68.0, web client):

- `user` in the sandbox had the UID 1000 and the GID 1000. ID 1000 is free on the Leaseweb image.
- `prepare` took 83 seconds. For a home of 1.1 GB, the export took 8 seconds and made an archive of
  974 MB, the copy from the sandbox to the VPS took 10 seconds, and the import took 2 seconds.
- With the row written first, the sandbox kept its state during the export, and the stopped sandbox
  stayed stopped for 3.5 minutes with no change of the row. In the old order (stop, then the row),
  the Worker resumed the sandbox in 6 seconds.
- After `start`, the host registered from the VPS in 129 seconds, with the same host key and no new
  sign-in. The data of the sandbox was there. A restart of the VPS gave the same result.
- An import of a cut archive failed and named `discard`. A second import and `start` refused.
  `discard` removed the data, and the full import then passed. `discard` and a second `start`
  refused after the start.
- A hosted server ran under the rules of `leaseweb-bootstrap.sh`.
- The web client showed no restart action for the moved server, and showed it again after the
  rollback. With a Worker from before `restartAvailable`, it showed the message of the Worker.
- A plan end set `desired_state = 'stopped'`, and a renewal set `running` again.
- Rollback: the client request resumed the sandbox in 15 seconds, and the host registered from the
  sandbox. A restart of the VPS started no OpenBot.
- A delete of the moved server through the Worker deleted the retired sandbox at boat.

Not confirmed:

- a move of a server that has a signed-in provider, agents and chats of a real customer. The test
  server had one file and no provider;
- an update request of a hosted server under the rules of `leaseweb-bootstrap.sh`;
- the behavior of Signal while the sandbox and the VPS both have the host ID. The test never ran both;
- the restart action in the desktop and mobile clients. They read the same field through the same
  gate, and only the web client was checked;
- the cause of five `turn.openbot.run` resolve errors on the first start on the VPS in the first
  test. The second test did not look for them.

Tested on 2026-11-11 on one VPS (FRA-01, 6 vCPU, 16 GiB, Ubuntu 24.04, OpenBot 0.67.1):

- `bun scripts/hosting/leaseweb-bootstrap-e2e.ts --host=root@<address> --restart=yes` passed its 75
  checks. It runs the bootstrap two times, connects as the service user and as root, stops the rules,
  and restarts the server. The report is in `.openbot-build/leaseweb-bootstrap/`.
- Rescue: `attachIso` with `GRML` and then `reboot` started the GRML system. Its console gave a root
  shell with no password, and `mount -o ro,noload /dev/sda2` showed the files of the server. After
  `detachIso` and `reboot`, Ubuntu started 173 seconds after the call, and OpenBot was online 55
  seconds later.

An order test through the Leaseweb API on 2026-11-11, with an API key of an account of the German
sales organization (locations FRA-01, FRA-10 and FRA-14), did not order a server:

- `GET /ordering/v1/products/vps?location=FRA-01` answers `404 Product configurator not found`, and
  `GET` and `POST /ordering/v1/products/vps/VPS02_2` (the order with `dryRun: true`) answer
  `404 Product not found`. Another location answers `403`. The same key reads
  `/ordering/v2/products/dedicatedServers?location=FRA-01`, `/publicCloud/v1/vps`,
  `/account/v1/orders` and `/services/v1/services`. Thus the key and the account are accepted, and
  the VPS order is not available to this account. The cause is not confirmed: Leaseweb documents
  that the order API needs a verified customer who pays by invoice with no prepayment, and the first
  order of this account was paid in advance.
- `/services/v1/services` shows the VPS as `cancellable`, with a 1-month term that starts on the
  first day of the next month: a server from 2026-11-11 has `contractTermEndDate` 2026-12-31.
  `POST /services/v1/services/{id}/cancel` exists and was not called.
- `PUT /publicCloud/v1/vps/{id}/reinstall` with `{"imageId": "UBUNTU_26_04_64BIT"}` answers `202`
  and deletes the disk. The test VPS had Ubuntu 26.04.1 (kernel 7.0) and an open SSH port 37 seconds
  later, with a new root password in `/credentials`. `install-server.sh` then took 98 seconds, and
  `leaseweb-bootstrap-e2e.ts --restart=yes` passed its 75 checks. Ubuntu 26.04 has the `install`
  command of uutils, which refuses `/dev/stdin` as the source when the target exists; the bootstrap
  thus writes its files with `cat`. The bootstrap with this change was not run again on Ubuntu 24.04.
- On Ubuntu 26.04, the server signed in with `openbot login`, and the web client connected to it. An
  agent with a free OpenCode model ran a shell command as the service user and read a web page. After
  a restart, the server was online again with no new sign-in, and the agent had its chat. The log
  has `Failed to resolve address for turn.openbot.run` lines when a client connects, although the
  service user resolves that name; the cause is not known, and the connection was made.
- The configurator of the Leaseweb shop, on the same day, marks Frankfurt (FRA-01) as out of stock
  for each VPS package (`VPS02_1` to `VPS02_6`), and Montreal and Tokyo too. Amsterdam, London,
  Washington, San Francisco, Los Angeles, Singapore and Sydney are in stock. This is the probable
  cause of the `404` for FRA-01. A pool of ready servers must thus not depend on one location.
- A second account, of the Netherlands sales organization, got 10 servers on 2026-11-11 (VPS 2,
  AMS-01, Ubuntu 26.04) from one shop order: the order was at 17:22 UTC and the servers started
  from 17:44 to 17:45 UTC. Each has a 1-year term to 2027-11-30 with a bill each month (EUR 8.09),
  and `cancellable: true`. With the key of this account, `GET /ordering/v1/products/vps?location=AMS-01`
  answers `200` with the packages `VPS02_1` to `VPS02_6`. No order was sent through the API.
- The first daily update on Ubuntu 26.04 restarted `openbot.service`: `needrestart` restarts each
  service that uses an updated library. The bootstrap now writes
  `/etc/needrestart/conf.d/50-openbot.conf`. After that, a reinstall of `libpcre2-8-0` restarted
  `cron.service`, `ssh.service` and six other services, and listed `openbot.service` as deferred; its
  start time did not change. The E2E reads the value that `needrestart` uses for the unit.
- Operator keys: the E2E adds a temporary key to the list. That key signed in as root and not as the
  service user, a key outside the list did not sign in, a list with a bad line changed nothing, and a
  run with the first list removed the key. With `--restart=yes` on Ubuntu 26.04 it passed its 91
  checks. The test VPS then had the two keys of another server of the operators and no
  `/root/.ssh/authorized_keys`, and an operator signed in.
- The Ubuntu 26.04 image of Leaseweb has GRUB 2.14 on the disk (GPT with a BIOS boot partition) and
  no GRUB package, so it has no `update-grub`. The daily update installed kernel 7.0.0-43, and
  `/boot/grub/grub.cfg` got no entry for it: after two restarts the server still ran 7.0.0-38.
  Without a fix, a kernel security update has no effect on this image. The bootstrap now installs
  `grub-pc`, which writes GRUB to the disk and adds `update-grub` to the kernel hooks. With the
  package removed again, the E2E ran the bootstrap and restarted the server: it ran 7.0.0-43 with
  the arguments `ro net.ifnames=0 quiet splash`, SSH answered 23 seconds after the restart command,
  and OpenBot was online 5 seconds later.
- The three names of the test VPS changed: the reference through the API, the server name with
  `openbot name`, and the hostname, which stayed after a restart of the server.

Not confirmed for Leaseweb:

- `needrestart` on Ubuntu 24.04, and the bootstrap of this version on Ubuntu 24.04;
- if the Ubuntu 24.04 image of Leaseweb has `update-grub`, and the kernel fix on a server that
  starts with UEFI (the bootstrap prints a warning there and changes nothing);
- a kernel update that comes after the fix. The boot entry of the kernel that was there is confirmed,
  and `zz-update-grub` is in the kernel hooks;
- another distribution than Ubuntu 24.04 and 26.04, and a network that does not use `systemd-networkd` (the
  helper reads the DHCP server from its lease files);
- a router address that changes while the server runs. The rules change at the next start of
  OpenBot;
- `resetPassword`, which needs the guest agent, and a custom image for a VPS;
- why the start after `detachIso` took 173 seconds;
- WebRTC with a rule set that also filters incoming connections.

### Reuse a pool machine

A pool machine has one server at a time. When the server ends, the machine gets a new operating
system and goes back to the pool for the next new server or the next move. The Worker and the operator share the work:

1. The plan ends. The Worker sets `desired_state = 'stopped'` and `plan_ended_at`. `sync` stops
   OpenBot on the machine. The data stays, so the owner can renew.
2. 30 days after `plan_ended_at`, the cron of the Worker deletes the server when its newest
   subscription is not open and Stripe reports it `canceled`. The delete is the one of the owner: the
   old sandbox, the Remote host and the session go, and `observed_state = 'deleted'`. A subscription
   that Stripe still retries (`past_due`, `unpaid`, `paused`) keeps the server, with no limit: the
   operator decides. A renewal before the 30 days keeps the server. The 30 days are
   `OPERATOR_HOST_DATA_KEPT_MS` in `hosted-server-service.ts`.
3. `sync` reinstalls the machine with `UBUNTU_26_04_64BIT`, which erases the disk, sets its reference
   to `pool-free`, and sets `operator_host = NULL` on the deleted row. The machine is free.
   Leaseweb shows the state `RUNNING` for the whole reinstall, so `sync` waits until SSH shows new
   host keys.
4. `prepare` installs OpenBot on the free machine again and offers it for a new server
   ([A new server on a pool machine](#a-new-server-on-a-pool-machine)).

A server that ended before migration 0053 gets `plan_ended_at` at the first cron run after the deploy,
so its 30 days start then.

Tested on 2026-11-12 with the test Worker, its D1 and one VPS in `AMS-01`: `add`, `status`, `sync`
stop and start, the cron delete of a server whose plan ended 31 days before with a `canceled` Stripe
test subscription, then `sync`. The reinstall took 51 seconds: the machine started 26 seconds after
the request, and `sync` returned 25 seconds later. A file in `/root` and `/opt/OpenBot` were gone.
Then `remove` and `add`.

`operator_hosts` has one row for each machine that was in the pool:

| Column | Value |
| --- | --- |
| `host_id` | `leaseweb:<VPS ID>`, as in `hosted_servers.operator_host`. |
| `location` | The Leaseweb data center, such as `AMS-01`. |
| `product` | `VPS01`, `VPS02` or `VPS03`, from the Leaseweb pack. |
| `added_at` | When the operator added the machine. |
| `removed_at` | When the machine left the pool. `NULL` while it is in the pool. |
| `assign_token_hash` | The SHA-256 of the token with which the machine asks for a new server. `NULL` when the machine is not offered. Migration 0055. |
| `seen_at` | When the machine asked last. |

`scripts/hosting/leaseweb-pool.ts` does the operator work. It shows what it would do and changes
nothing without `--apply`. It reads the Leaseweb keys and the Cloudflare token from the environment,
so it runs on each computer that has the key file, and it can run on a server of the operator later:

```bash
bunx dotenvx run -f apps/auth-api/.env.production -fk <root>/.env.keys -- \
  bun scripts/hosting/leaseweb-pool.ts <command> [--apply] [--env=test]
```

| Command | Work |
| --- | --- |
| `status` | Read only. Free and ready machines of each location and product, each free machine that is not ready, each new server that waits for its sign-in, and the work of `sync`. |
| `add <VPS ID>...` | Adds bought machines. It reads the location and the product from Leaseweb, and sets the reference `pool-free` when the machine has none. It refuses a machine with another reference. |
| `remove <VPS ID>...` | Takes a free machine out of the pool, for example before its contract ends. It refuses a machine that a server has. |
| `sync` | Stops OpenBot where a plan ended, starts it where the owner renewed, and reinstalls each machine of a deleted server. It reinstalls only a machine of the pool. It also sets the reference of each machine on which a new server started. |
| `prepare <VPS ID>... --keys=<file> [--reinstall]` | Installs the newest release, disabled, on free machines, runs the bootstrap with the operator keys in `<file>`, restarts each machine, and offers it for a new server. A prepared machine with no server data and an older OpenBot gets the newest release (`move-from-boat.sh upgrade`); `move` does the same. A disabled OpenBot does not update itself, so run `prepare` again after each release. A free machine that has the data of a server (a start that failed) is skipped; `--reinstall` erases it first. |
| `move <server ID> <VPS ID> [--keys=<file>]` | Moves one server from boat to a free machine. See [Move a server from boat](#move-a-server-from-boat). It prepares the machine when necessary. The machine takes no new server from then on. |

`sync` connects as root over SSH with the key of the operator. Not confirmed: SSH from a server of the
operator. One key of the computer that runs `prepare` or `move` must be in `--keys`: the bootstrap
turns off the password, and the script refuses a list without such a key.

The OpenPanel dashboard "Server pool" (project `openbot`) shows the pool. Each 5 minutes, the
production Worker sends one `hosted_pool_snapshot` event for each location and product and one with
`location = all` (see `ANALYTICS.md`). The test Worker has no OpenPanel keys and sends none. Each
report is a bar with the largest value of the snapshots in the last 30 minutes. Two local patches of
the OpenPanel dashboard make this work: a bar with the `max` metric reads the value of each minute,
and a tile with its own 30-minute range keeps it when the dashboard date picker has a longer range.
A longer interval adds up more than one snapshot. The snapshot counts each machine in one state:

| State | Machine |
| --- | --- |
| `free` | No server. Ready for a move. `ready` counts the free machines that a new server can get now. |
| `to_reinstall` | Its server is deleted. Free after the next `sync`. |
| `plan_ended` | Its plan ended. Free 30 days after `plan_ended_at`, unless the owner renews. |
| `cancel_scheduled` | The owner cancelled the plan at the period end, or scheduled a delete. |
| `in_use` | Each other server. |

`free_in_7d` and `free_in_30d` count the machines that are free in that time when no owner renews.
A machine whose plan ends at the period end is free 30 days after that end. A plan that ended with a
subscription that Stripe still retries, or with no subscription, has no date: the cron does not delete
that server. A server that names a machine that is not in the
pool is in the group `unknown`: add the machine. When `ready` is 0 for a product, the next customer of
that plan starts on boat. `bun run test:hosted-operator-pool` checks the
delete, the snapshot and its event on the real service with a fake Stripe and a fake boat.

## Not confirmed

These were not tested on boat. Test them before a user gets access:

- that production Signal accepts tickets from the `test` Worker;
- a lost response to the boat create call. A probe on 2026-09-29 confirmed that a second create
  with the same key and body returns the same sandbox, in its current state, and makes no second
  one. A lost answer was not tested on boat; the test uses a fake boat. If boat keeps a key for
  24 hours, a retry after that can make a second sandbox;
- a sandbox that boat no longer has (`404`). The Worker keeps its ID and shows `error`, and does not
  make a new sandbox by itself: a wrong `BOAT_API_KEY` also gives `404` for each sandbox. An operator
  must check the key before a user deletes the server;
- the vCPU, memory and disk of boat `large`;
- a downgrade that boat refuses with `type_too_small`. The test uses a fake boat;
- the disk of each size. The root file system showed 69 GB on `small` and on `default`, not the 12 GB
  and 50 GB of the boat machine table. The limit that `type_too_small` uses is not known. The plans
  show 12, 50 and 100 GB, which is not more than the machine table. The disk of `large` was not
  measured, so the 100 GB of Pro is not confirmed;
- that boat frees the key of a refused create, so a retry of a setup that failed works;
- the menu path of the Stripe failed-payment setting in [Production](#production), and whether test
  mode and live mode keep separate values;
- the [memory guards](#memory) with real agents: the held message, the turn slots and the release of
  idle provider threads on a server with a signed-in account;
- whether boat stops a sandbox that runs for weeks. The Worker restarts it, but work in progress
  at that time stops;
- whether boat runs the pre-stop hook for a stop that it starts by itself: maintenance (the
  `updating` state) or the end of `ttlSeconds`. A crash of the machine restores the last periodic
  save, which also copies files while they change;
- that OpenBot closes `openbot.db` at a `systemctl stop` on a server. The install test used a release
  without the `SIGTERM` handler. The `ExecStop` of the unit stops OpenBot before its Xvfb displays
  (see [Computer Use](architecture/computer-use.md#agent-display-on-a-server)). This was tested in a
  container with a stand-in for OpenBot, not with systemd. When OpenBot does not close the database,
  it is as after a crash, which SQLite recovers, because the save starts after the stop;
- the agent display on boat with a release build. On 2026-10-16 one boat server ran a 0.42.0 build
  with this change, from `openbot.service`: OpenBot was on Xvfb `:99` at 1280x800, and `:0` had no
  OpenBot window. In an agent turn, the agent shell and `cua-driver` had `DISPLAY=:0`, and Computer
  Use saw a 1920x1080 screen with only the panel and the dock. A local remote desktop session
  captured `:0`. The session reported the size of the OpenBot display, 1280x800. The first start
  after a resume, with this script in `/opt`, was not tested.


### Billing and server deletion

Billing lists each paid server separately. Cancel renewal stops the next payment; the
server stops when its plan ends and keeps its data. Keep server resumes renewal before
the plan ends and removes any scheduled deletion.

Delete server requires the server name. The owner can delete immediately with no refund
for unused time, or schedule deletion for the paid-through date. The account Worker stores
the date and subscription ID. The cron deletes on its next pass after that date only after
Stripe confirms the subscription has ended and no newer or open plan exists. Failed
provider deletion is retried through the existing deletion queue. Keep server and deletion
use the same per-server operation lease.
