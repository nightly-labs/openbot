# Hosted servers

A hosted server is an OpenBot server that runs in a [boat](https://boat.dev) sandbox, so it works
when the user's computer is off. Each server is one boat sandbox for one account. The sandbox runs
the Linux build of OpenBot on the boat desktop. The server runs while it is in use. After 15 minutes with no
use, the Worker stops it and keeps its data. The next client starts it again, and the Worker cron
starts it before its next routine run. A connected client counts as use for 1 hour after its last
request or typing event (`CLIENT_USE_WINDOW_MS`). A desktop app that is open in the background keeps
a connection to each stored server but sends no request, so it does not keep the server on for
longer than that. When the user comes back, the app starts the stopped server again.

The Worker enables hosted servers only when it has the boat and Stripe secrets and
`HOSTED_SERVER_TEMPLATE`, and only for the account IDs or emails in `HOSTED_SERVERS_ALLOWED_USER_IDS` (`*`
allows each account; with no value, no account can create a server). Production sets `*` in
`wrangler.jsonc`, so each account can buy a server. See [Production](#production). An account can have 3 servers that are not
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
| Account Worker | `apps/auth-api/src/server/hosted-server-service.ts`, `boat-client.ts` | Creates, restarts and deletes sandboxes. Stores state in D1 (`0023_hosted_servers.sql`). |
| Server template | `scripts/hosting/` | Builds the boat named snapshot that each server starts from. |
| Server bootstrap | `src/main/hosted-server-bootstrap.ts` | On the first start, redeems the claim, signs in, and publishes the host. |
| Start retry | `src/main/hosted-server-start-retry.ts` | Publishes the host again after a failed start. |
| Activity report | `src/main/hosted-server-activity.ts` | Tells the Worker that the server is in use, and when its next routine runs. |
| Memory guard | `src/main/hosted-server-memory.ts`, `src/backend/agent/memory-hold.ts`, `turn-slots.ts` | Reads the memory of the server, holds new turns when it is low, and limits the turns that run at the same time. See [Memory](#memory). |
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

   The Worker then names the sandbox `openbot-<plan>-<owner email>-<first 8 characters of the host
   ID>` (`PATCH /sandboxes/:id`), so an operator can find it in the boat dashboard. Each character of
   the email that is not a letter or a digit becomes `-`. The name is only a label; a plan change
   renames the sandbox.
3. **Env handoff.** boat puts the sandbox env in the setup script, not in systemd. The Worker sends
   `setupScript: exec /opt/OpenBot/hosted/openbot-hosted-env`. That helper writes the two values to
   `~/.config/openbot-hosted/env` (mode 0600). `openbot.service` waits for this file.
4. **First boot.** OpenBot starts with `OPENBOT_HOSTED_SERVER=1`. It redeems the claim at
   `POST /v2/hosting/claims/redeem`, signs in as the owner, keeps the host ID, and publishes the
   host. `registerHost` refuses the host ID for any other account.
5. **In use.** OpenBot checks each minute whether the server is in use: an agent works, a remote
   desktop or browser view is open, a file moves, or a remote client is connected (an open Team API
   event stream) and sent a request or a typing event in the last hour. It sends
   `POST /v2/hosting/servers/:id/activity` with `{inUse, nextRunAt}` and the session from its claim:
   at once when the use starts, then at most each 5 minutes while the use continues, and each time
   the next routine run changes. The Worker accepts only that session, not the owner's own sessions.
   It stores `last_active_at` for a report with use, and `next_run_at` (null for a time that is not
   in the future). A report with no body is from an older server: it counts as use and keeps
   `next_run_at`. When boat reports
   `archived` for a server in use (for example, after maintenance), the webhook resumes the sandbox
   at once. The Worker cron (each minute on `test`) resumes a server that stays `stopped` for 2
   minutes.

   **Idle.** The cron stops a running server with no activity and no state change for 15 minutes:
   `desired_state = 'idle'`, and boat saves the disk. It does not stop a server whose next routine
   run is less than 10 minutes away. The webhook does not resume an idle server. The next wake
   (step 6) sets it to `running` and resumes it. A start and a resume count as activity, so the first
   client has 15 minutes to connect.

   **Scheduled start.** The cron starts an idle server when its `next_run_at` is less than 10 minutes
   away (one cron interval and the start time), with the wake reason `schedule`. It clears
   `next_run_at` in the same update, so a server that does not report again starts only once for
   that run. After the start, OpenBot runs each routine that is due, and each run that it missed
   becomes one run.

   **Lease.** boat has no idle timer, and a boat trial refuses a sandbox with no auto-stop. Each
   create and resume sends `ttlSeconds: 7200`, so boat stops a sandbox that the Worker loses. An
   activity report extends the time (`PATCH /sandboxes/:id`) when less than 1 hour is left
   (`lease_until`). When boat stops a server in use at the end of its lease, the Worker resumes it.
6. **Start after a failure.** A client that cannot reach the host calls
   `POST /v2/hosting/servers/:id/wake` (owner or member; 404 for a host that is not a hosted
   server). This resumes a `stopped` sandbox or one in `error`. The desktop does this when Signal
   answers `host_unavailable`, at most once a minute for each host. The web client does this when a
   connection fails, then connects again every 5 seconds. The mobile app does the same for the
   selected server while the app is in the foreground. A server whose plan ended answers
   `402 plan_required`.

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
8. **Plan change.** In the Customer Portal an upgrade is charged at once, and a downgrade or a
   shorter interval starts at the next period. The Worker copies the new plan, interval and currency
   to the server. boat changes the machine of a sandbox only on a resume (`type`), so the Worker
   stops a running server (boat saves the disk) and resumes it on the machine of the new plan. The
   server is offline for this time, so the Worker waits until the server has no use: no activity
   report for 7 minutes (a server in use reports each 5 minutes). A server that stops for no use,
   or that was not running at the plan change, gets the new machine at its next resume. When the data does not fit a smaller machine, boat refuses it
   (`409 type_too_small`); the server then starts on its old machine, and the Worker does not try
   again until the next plan change.
9. **Delete.** `DELETE /v2/hosting/servers/:id` with `{confirmName}`. The Worker first closes the
   open Checkout page. When the user paid on it just now, the Worker keeps the server and answers
   `409 hosted_server_paid`, so the owner sees the server before a second delete cancels the plan.
   Then it cancels the open plan now, with no refund. A Stripe failure stops the delete (502), so
   the user does not pay for a deleted server. Then it deletes the sandbox and its Remote host. The D1 row stays with `desired_state = 'deleted'`, so a sandbox is never
   left without a record.

## Providers

OpenBot ships no AI subscription, so a new server has no provider connected. When its owner or an
admin opens a server with no agent, the app shows a provider step before the first-agent form. The
sandbox browser is on Xvfb, where nobody can see it, so each sign-in finishes on the user's own device
over `providers-v3`: Codex and Grok show a device code, and Claude shows a page whose code the user
pastes back into the app. The Claude sign-in runs under `script` from util-linux (package
`bsdutils`, in every Ubuntu and Debian image). See
[Admin capabilities](ARCHITECTURE.md#admin-capabilities) for the routes.

## Members

The plan sets the number of active members, owner included: Starter 3, Standard 10 and Pro 25
(`BILLING_PLANS`). A host with no plan has 3 (`DEFAULT_TEAM_MEMBER_LIMIT`). The Worker reads the plan
with `getServerEntitlement` when a member joins or is reactivated, and refuses a member over the limit
(`409 member_limit_reached`). This also applies to a self-hosted host that has a plan.

- A lower limit after a plan change or a plan end removes no one. Active members keep their seats.
  A new join or a reactivation waits for a free seat.
- The host list (`GET /v2/remote/hosts/`) gives `memberLimit` for each host. The desktop, web and
  mobile member screens show it. They use 3 when an older Worker sends no limit.
- After each subscription sync, the Worker sends `account-servers-changed` to each active member,
  so their devices read the host list, and the new limit, again.
- A host that is not on an account keeps 3 in its own store (`src/main/team-store.ts`). It has no plan.

## Configure the test Worker

`HOSTED_SERVERS_ENABLED` is `true` in `env.test` of `apps/auth-api/wrangler.jsonc`.
`bun run api:deploy:test` sets `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `BOAT_API_KEY` and
`BOAT_WEBHOOK_SECRET` from the encrypted `apps/auth-api/.env.shared` on each deploy, so a value that
you set by hand for these four is replaced. `bun run hosting:setup --target=test` makes the two
webhooks and writes their secrets to that file. It also sets the allow list from
`HOSTED_SERVERS_TEST_ALLOW_LIST` in that file. Set the template with
`wrangler secret put HOSTED_SERVER_TEMPLATE --env test` from `apps/auth-api`:

| Name | Value |
| --- | --- |
| `HOSTED_SERVER_TEMPLATE` | The named snapshot from the template build, such as `openbot-server-0-9-0`. |
| `HOSTED_SERVERS_ALLOWED_USER_IDS` | Comma-separated account IDs or emails that can create servers. `api:deploy:test` sets it from `HOSTED_SERVERS_TEST_ALLOW_LIST` and refuses `*`: the test Worker is public, and it shares its boat account with production. |

The `BOAT_API_KEY` in `.env.shared` is the development key of the boat test account. It also has
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

Each developer who has `DOTENV_PRIVATE_KEY_SHARED` can create a server with any account. The
command decrypts `HOSTED_SERVERS_DEVELOPER_KEY` from `.env.shared`, and main sends it in the
`OpenBot-Hosting-Developer-Key` header of each hosted server request. The test Worker has the same
key and lets the account create servers. A clone of the repository cannot decrypt the key. Main
removes the key from its environment at the start, so agents do not get it, and a packaged build
never sends it. To change the key, set a new one and deploy:

```bash
bunx dotenvx set HOSTED_SERVERS_DEVELOPER_KEY "$(openssl rand -hex 32)" -f apps/auth-api/.env.shared -fk .env.keys
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
2. **Template.** Build it from the release AppImage with the production account service:
   `bun run hosting:template --version=<v> --appimage-url=<release AppImage URL>
   --appimage-sha256=<hex> --auth-api-url=https://api.openbot.run`. A server updates itself to
   each new release ([Updates](#updates)), so a new template only makes the first start of a new
   server faster.
3. **Webhooks and secrets.** Put the live Stripe key and the Worker boat key in the shell, so they
   are not in the history, and run the setup with `gh` signed in:

   ```sh
   read -rs STRIPE_SECRET_KEY && read -rs BOAT_API_KEY && export STRIPE_SECRET_KEY BOAT_API_KEY
   bun run hosting:setup --target=production --template=<snapshot from step 2>
   ```

   It makes the six Prices, the Customer Portal settings, the Stripe webhook endpoint and the boat
   webhook. It writes the two keys, the two webhook signing secrets and the template to the `cloudflare-production` GitHub Environment. Run it again at any time: it keeps
   a secret that the Environment has. `--replace-webhooks` makes new signing secrets.
4. **Stripe Dashboard.** In live mode, in the failed-payment settings for subscriptions (Revenue
   recovery → Retries), set "If all retries for a payment fail" to cancel the subscription or to
   mark it unpaid. Both stop the server.
5. **OpenPanel.** In the production project, make a server client. Its ID and secret send the
   billing and server events in [ANALYTICS.md](../ANALYTICS.md). Only production gets them.
6. **Secrets.** The `Deploy Cloudflare production` job in `.github/workflows/ci.yml` sends these
   from the `cloudflare-production` GitHub Environment. It refuses a set with only some values and a
   Stripe key that is not live. A value that is not set keeps the value that the Worker has; to turn
   a feature off, run `wrangler secret delete <name>`.

   | Name | Kind | Value |
   | --- | --- | --- |
   | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | secrets, a pair | Step 3 writes them |
   | `BOAT_API_KEY`, `BOAT_WEBHOOK_SECRET` | secrets, a pair | Step 3 writes them |
   | `OPENPANEL_CLIENT_ID`, `OPENPANEL_CLIENT_SECRET` | secrets, a pair | The client from step 5 |
   | `HOSTED_SERVER_TEMPLATE` | variable | Step 3 (`--template`) writes the snapshot name from step 2 |

   The CI deploy is the production path: `.env.production` does not have all the values that it
   needs, such as `SITE_REPORT_HASH_SECRET`. `bun run api:deploy` sends the same names from
   `.env.production` and checks them the same way.
7. **Check.** After the deploy, sign in with an allowed account, add a Starter server, pay, and
   connect from the desktop and the web client. Delete the server at the end.

The cron runs each 5 minutes in production. An idle server stops 15 to 20 minutes after its last
use, and the checks that repair a missed webhook run at most 5 minutes late.

## Build the server template

The template is a boat named snapshot. Build one from a release; each server then updates itself:

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
3. checks that OpenBot did not start and that no profile or claim exists;
4. saves the builder as `openbot-server-<version>` and deletes the builder.

The builder never starts OpenBot, so the template has no host identity and no session. boat keeps
at most 10 named snapshots for each account.

### Updates

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
2. `openbot-update-apply.service` runs `apply` at boot, before `openbot.service`. boat stop and resume
   work like a reboot, so the new release starts at the next wake of the server, not during use. It
   copies `staged` to `app`, and then installs the scripts, AppArmor profile and units of the new
   release. `.applying` and `staged` stay until all of this is complete, so after a stop or a
   failure the next boot does it again, and `stage` does nothing until then. `openbot.service`
   does not require `apply`, so it starts after a failure too: with the old release, or with a
   partial copy after a failed copy, until the next boot.

boat saves `/opt` by the paths that change, and it does not look into a directory that a rename
moves. After the next stop, such a directory is empty or has its old files. So a release gets to
`/opt` only as a copy of each file, never with `mv`. A file rename is safe. [Observed on a boat VM
with a probe; not in boat documentation.]

boat resumes a server on a machine that booted before, restores the disk lazily, and starts the
units before the restore ends. `stage` waits until the restore ends (at most 4 minutes). `apply`
waits only when it finds `staged.ready` or `.applying`, because OpenBot starts after it. When the
restore does not show a staged release yet, the release applies at the next boot.
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
with `--password-store=gnome-libsecret`. OpenBot uses the boat desktop: the lightdm session of the
sandbox user on `:0`, with openbox. So boat's desktop viewer and OpenBot remote desktop show the same
screen, and a click moves the keyboard focus to another window. After a resume, the script waits up
to 2 minutes for that session. With no session, OpenBot runs under `xvfb-run`. The keyring files are
in `/srv/openbot-hosted/keyrings`:

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
the claim work again, and the server signs in with a new session. A new `REMOTE_TICKET_PRIVATE_JWK` changes
each claim, so a VM that has no working session cannot sign in after the change; delete that server.

A start that cannot reach the account server does not use the claim. The start retry signs in
again with backoff (30 s to 10 min) and then publishes the host.

## Memory

One systemd unit holds OpenBot, its browser tabs and every agent process: one `claude` process for
each thread, and one set of MCP servers for each ACP session. A Starter server has 4 GB. The guards
are only on a hosted server; the desktop app does not change.

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

The app (`HostedServerMemory`) reads the memory every 5 s. The free memory is the smaller of
`MemAvailable` and the free memory of the unit's cgroup (cgroup v2 `memory.max − memory.current`,
plus `inactive_file` from `memory.stat`: the kernel takes that file cache back before the OOM killer
acts). Each turn that started in the last 60 s counts 300 MB more, so routines that start together
do not all pass the check before their processes grow. A start that fails counts nothing.

| Level | When | What happens |
| --- | --- | --- |
| `ok` | Other times. After `low`, only at 256 MB above the `low` limit. | Turns start. |
| `low` | Free memory is less than 512 MB or 12% of the total. | No new turn starts; the message stays queued. The agent shows one notice in each low period. The browser opens no new tab. |
| `critical` | Free memory is less than 256 MB or 6% of the total. | As `low`. Also, the provider threads with no turn close one time. They open again from their session at the next turn. |

When the level is `ok` again, each held message starts. If a file cannot be read, the level stays
`ok` and main logs one warning.

Only a fixed number of turns run at the same time, from the memory of the server: 4 up to 5 GiB,
8 up to 10 GiB, and 16 above. A turn that starts, runs, or compacts the context uses a slot. When
the slots are full, the messages wait in the queue: a message from a person starts first, then
routine runs and teammate messages, and the oldest first in each group. No turn waits for a slot
that another turn holds, because a message to a teammate ends the turn that sends it. A queued
message counts as use, so the server does not stop while messages wait.

An agent's browser tab that nobody uses for 30 minutes unloads its page and keeps a blank page, as a
restored tab does. The tab stays in the list with its URL, title and last preview. The next use by the agent or
a person loads the page again, without its history and page state. When memory is `low`, a tab
unloads after 5 minutes. The active tab, a popup and its opener, and a tab with a
takeover, a secret, a recording, a live view, staged uploads or sound do not unload. This also
applies to the desktop app.

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

A resize test on 2026-09-28 (one plain sandbox with `noEnv`, `small → default → small`, each a stop
and a resume with `type`) confirmed that boat changes the machine in place with the same sandbox
ID (2 vCPU/4 GB, then 4 vCPU/8 GB, then 2 vCPU/4 GB). Files in `/srv` and in the home folder stayed,
and an enabled systemd unit started again after each resume. The stop took 25 to 31 s, and the
sandbox was `idle` 3 to 6 s after the resume call.

A memory test on 2026-09-30 (one `small` sandbox with `noEnv`, the scripts and the Linux AppImage of
main, and a `HostedServerMemory` driver in a unit with the same limits as `openbot.service`)
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
  at that time stops.
