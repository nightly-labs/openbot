# OpenBot Auth API

This TanStack Start and Solid 2 package is the central OpenBot account API. It
runs on Cloudflare Workers, stores account and authentication records in D1,
and stores account avatars in R2. Users sign in with an eight-character
one-time email code. D1 stores hashes instead of plaintext codes, session tokens,
and team authentication tickets.

## Local development

`.env.dev` is the committed encrypted development file. Local identity keys and saved overrides
stay in ignored `.openbot/dev-state.json`. A checkout without a development key starts with stable
generated local defaults. Existing state files remain valid.

The update resets values that exist only in the old generated `.env.dev`; it does not import them.
Local identity and custom settings already saved in `.openbot/dev-state.json` stay unchanged.
Set new manual overrides in the shell. The load order is shell values, saved local overrides,
decrypted development settings, then generated defaults. An explicit empty value is an override.
Shared settings do not replace the local ticket keys, auth webhook secret, report hash secret, or
skills admin token. Shell values and saved overrides can replace these local values.

The encrypted `.env.dev` holds the Stripe sandbox keys, the development `BOAT_API_KEY`, and the webhook secrets of the `test`
Worker. The boat key creates real VMs, but only when the Worker also has
`HOSTED_SERVER_TEMPLATE`. `wrangler.jsonc` sets
`HOSTED_SERVERS_ENABLED` to `true` and `HOSTED_SERVERS_ALLOWED_USER_IDS` to `*`, so a local Worker
with a template lets each local account create one. Set `HOSTED_SERVERS_ALLOWED_USER_IDS` in the
shell to limit access. A VM cannot reach a local Worker, so use `bun run dev --hosting=test` for a real server (see
[Real servers from a development build](../../docs/hosted-servers.md#real-servers-from-a-development-build)).
Set `DOTENV_PRIVATE_KEY_DEV` in your shell profile to load the shared values in every worktree.
Without this key, the Worker starts with generated local defaults and no Stripe or boat keys. Shell
values override shared values. Development commands do not read the root `.env.keys`; production
commands continue to use that file.

### Stripe sandbox

`bun run api:stripe:bootstrap` creates the six plan Prices (lookup keys `openbot_{plan}_{month|year}`),
the license Price (`openbot_license_month`) and the Customer Portal settings in the Stripe account of `STRIPE_SECRET_KEY`. It is safe to run
again: a changed amount makes a new Price and moves the lookup key to it. In the Portal, an upgrade
is charged at once, and a downgrade or a shorter interval starts at the next period.

For a local Worker, forward the webhooks and set the secret that `stripe listen` prints in your
shell as `STRIPE_WEBHOOK_SECRET`:

```bash
stripe listen --forward-to http://127.0.0.1:3100/v1/stripe/webhook
```

For the `test` Worker, `bun run hosting:setup --target=test` makes or updates its Stripe and boat
webhooks and writes their signing secrets to `.env.dev`. Run it with `DOTENV_PRIVATE_KEY_DEV`
set in the shell. Then run `bun run api:deploy:test`. It
also sets the allow list from `HOSTED_SERVERS_TEST_ALLOW_LIST` and the developer key
`HOSTED_SERVERS_DEVELOPER_KEY` from `.env.dev`.

`scripts/stripe-flows-e2e.ts` checks the plan flows against the sandbox and a local Worker: renewal,
failed renewal, cancel at the period end, plan change, renew, delete, another account's server, a
deleted customer, a refund, a dispute, and the welcome email of a first plan. The `license-*`
scenarios check the license: buy, Checkout, one open Checkout page, change users, the user count,
renewal, failed renewal, currency, isolation from the server plans, and the user limit at a join. Each scenario uses a Stripe
test clock and deletes it at the end. Start the Worker
with `HOSTED_SERVERS_ENABLED=true`, `HOSTED_SERVERS_ALLOWED_USER_IDS` set to the output of
`bun scripts/stripe-flows-e2e.ts --print-user-ids`, `HOSTED_SERVER_TEMPLATE=e2e-template`, and
`BOAT_API_KEY=e2e-invalid-key`, and forward the webhooks to it. Without a template, hosting is off and
each server scenario fails with `hosting_unavailable`. A value in the shell overrides `.env.dev`; without the fake key, each paid
scenario creates a real boat VM. Then, from the
repository root:

```bash
bun scripts/stripe-flows-e2e.ts --api http://127.0.0.1:<port> [scenario ...]
```

The `portal` scenario prints a Customer Portal cancel page and then an update page, and waits until
you use them. The report goes to `.openbot-build/stripe-flows-e2e.json`.

The `boat` scenario runs only when you name it. It pays for a server, waits until OpenBot in the VM
signs in and publishes the host, restarts the service to check the stored session, and deletes the
server. It needs the real `BOAT_API_KEY`, a template from `bun run hosting:template` whose
`--auth-api-url` reaches your Worker (for example a `cloudflared tunnel --url` to its port), and
`HOSTED_SERVER_TEMPLATE` set to that template. Start the Worker with
`__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=.trycloudflare.com`, or Vite refuses the tunnel host. A boat
trial account allows only `small` and `default`, so use a Starter or Standard plan there.

`bun run api:deploy:test` loads the `.env.dev` values before `.env.production`. Shell
values still win, so the test Worker gets the sandbox keys and never live keys.

`.env.production` is the encrypted production file, and its private key stays in the ignored root
`.env.keys`. Production commands decrypt it only in process memory. Development commands use the
shell key described above and never read the root key file. New worktrees do not copy root
`.env.keys`; run production commands from a checkout that has the existing production key file.

```bash
bun run api:migrate:local
bun run dev:api
```

The local address is `http://127.0.0.1:3100`. The explicit development flag
returns the sign-in code in the API response. It never writes the code to logs.

Update and validate the encrypted production file with these commands:

```bash
printf '%s' '<APP_PASSWORD>' | bun run env:set:smtp
bun run env:validate:prod
```

Commit the encrypted `.env.production` and `.env.dev` files. Never commit `.env.keys` or local
state from `.openbot/`.

## Article artwork

The `/news` and `/guides` cards and social images come from a WebGL shader. A
Worker has no WebGL and a CI runner has no GPU, so the images are drawn on a
developer's machine and committed in `content-art/`. After you add an article or
change a title, run this and commit the folder:

```bash
bun run api:images
```

It draws only the images whose inputs changed and deletes images that no
article uses. `content-art/manifest.json` records a hash of the inputs of each
image. The build compares those hashes with the articles and fails when an image
is missing, out of date, or belongs to no article.

## Home page beam

The home page beam is a SolidJS port of
[LaserFlow from React Bits](https://reactbits.dev/animations/laser-flow). Its license lets the
website use it, but does not let this public repository contain it. The port is in the private
`nightly-labs/openbot-laser-flow` repository. Git ignores its path here, and a checkout without it
builds a home page with no beam. To see the beam locally, clone it into that path:

```bash
git clone git@github.com:nightly-labs/openbot-laser-flow.git apps/auth-api/src/vendor/laser-flow
```

CI checks it out with the read-only deploy key in the `LASER_FLOW_DEPLOY_KEY` secret. Pull request
previews from forks have no beam. A production deploy, from CI or from `bun run deploy`, stops
before any change when the port is missing. Never copy the file into this repository.

## Email delivery

Private Email SMTP is the primary delivery method. Use a separate app password.
Do not use the mailbox password.

Local development sends no email at all. Generated local defaults blank all five SMTP
variables, which is what turns delivery off - `wrangler.jsonc` sets four of them
in the top-level `vars` that local `vite dev` reads, and four out of five is the
partial configuration `readSmtpConfig` rejects. The team-invitation endpoint then
answers `503 email_delivery_not_configured`; login never reaches SMTP at all,
because `AUTH_EXPOSE_DEVELOPMENT_CODE` returns its code in the API response. To
exercise real delivery locally, put a full set in the ignored `.dev.vars` file:

```dotenv
EMAIL_SMTP_HOST=mail.privateemail.com
EMAIL_SMTP_PORT=465
EMAIL_SMTP_USERNAME=hello@openbot.run
EMAIL_SMTP_PASSWORD=<PRIVATE_EMAIL_APP_PASSWORD>
EMAIL_FROM=hello@openbot.run
```

`bun run env:set:smtp` encrypts the app password into `.env.production` only.

For a deployed Worker, `bun run api:deploy` decrypts `.env.production`. It sends
`EMAIL_SMTP_PASSWORD`, `SKILLS_ADMIN_TOKEN`, `REMOTE_TICKET_PRIVATE_JWK`,
`REMOTE_TICKET_PUBLIC_JWKS`, `REMOTE_AUTH_WEBHOOK_SECRET`, and `SITE_REPORT_HASH_SECRET` to
`wrangler secret put` through standard input, and `GITHUB_APP_PRIVATE_KEY` when it is set. It then
builds and deploys the Worker. Production deployment preserves `HOSTED_SERVER_TEMPLATE`; the
desktop release workflow owns that setting. Test deployment can still set its own template.

Production also requires `OPENPANEL_CLIENT_ID` and `OPENPANEL_CLIENT_SECRET` from an OpenPanel
write-only server client. Keep both in the encrypted `.env.production` for local deployment and in
the `cloudflare-production` GitHub Environment for CI. Both deployment paths check these values
before remote changes. Test deployments do not send account analytics.

`GITHUB_APP_PRIVATE_KEY` is the OpenBot GitHub App's private key as a PKCS #8 PEM. GitHub gives a
PKCS #1 key; convert it with `openssl pkcs8 -topk8 -nocrypt -in <key>.pem`. With the key, the
Worker gives the desktop installation tokens, so GitHub shows `openbotgit[bot]` as the author of an
agent's work. With no key, the desktop acts as the signed-in user. In GitHub Actions the secret is
`OPENBOT_GITHUB_APP_PRIVATE_KEY`, because GitHub refuses secret names that start with `GITHUB_`.
Secrets are never passed as process arguments. The other values are Worker
variables. The SMTP connection uses TLS from the start and accepts only port 465.

GitHub Actions reads the remote-control secrets, `SKILLS_ADMIN_TOKEN`, `SITE_REPORT_HASH_SECRET`, and the optional
`SITE_OPERATIONS_ADMIN_TOKEN` and `SERVER_CLAIMS_ADMIN_TOKEN` from the `cloudflare-production` Environment. It includes
them in Wrangler's temporary runtime secrets file.

`SERVER_CLAIMS_ADMIN_TOKEN` lets an operator sign a new server in for a user without an email code: see
[server claims](../../docs/self-hosted-server.md#sign-in-with-a-server-claim). Without it, the endpoint answers 401.

Use `bun run api:deploy:test` for the isolated `openbot-auth-api-test` Worker
and the `openbot-auth-test` D1 database.

As a fallback, set `EMAIL_DELIVERY_WEBHOOK_URL` to an HTTPS endpoint. OpenBot
sends this JSON:

```json
{
  "email": "person@example.com",
  "code": "ABCD-EFGH",
  "expiresAt": 1787060000000
}
```

If `EMAIL_DELIVERY_WEBHOOK_SECRET` is set, the request includes a Bearer token.
Do not enable `AUTH_EXPOSE_DEVELOPMENT_CODE` in production.

When the provider itself refuses a message with a sender limit, the Worker
answers 429 `email_delivery_rate_limited` instead of 502, for a sign-in code and
for a team invitation. The message is never sent in that case, so the app can
ask again later. Namecheap Private Email allows 500 messages an hour for each
mailbox, and every sign-in code and invitation spends that same quota.

The contact form on `/contact` posts to `/v1/contact`. The Worker sends each message to
`EMAIL_FROM` through SMTP, with the visitor's address in `Reply-To`, and stores nothing.
The D1 counter of sign-in allows 3 messages for each IP address and 15 in total in each 15-minute
window, so the form cannot spend the quota that sign-in codes need. A Cloudflare rate-limit binding
counts in each location separately, so it cannot hold a total. Without SMTP the route answers 503
`email_delivery_not_configured`, and the form tells the visitor to write to `hello@openbot.run`.

## Cloudflare deployment

Create the D1 database and replace the placeholder `database_id` in
`wrangler.jsonc`. Apply remote migrations and set delivery secrets through
Wrangler. Then deploy the Worker.

```bash
bun run api:migrate:remote
bun run api:deploy
```

The service applies limits per email, per IP, per challenge, and per resend.

A deploy replaces every file under `/assets/`. Before a production deploy, CI and `bun run api:deploy`
run `scripts/keep-previous-assets.ts`. It copies the files of the builds that were live in the last
24 hours from `https://openbot.run` into the new build, so a tab that is open during a deploy can
still load code. The site keeps the list of these files in `/asset-history.json`. When the list or a
file cannot be read, the deploy continues with fewer files, and such a tab reloads when it next loads
code.

## Hosted sites

`/v1/sites` takes two optional headers: `OpenBot-Host-Id` and `OpenBot-Host-Token`, the machine token
of a registered server. With them, a request sees only that server's sites, and a new site counts
against the server plan's limit. A wrong token gets 401 `host_unauthorized`. Without them, a new site
goes into the account's unlinked bucket of one site; `GET /v1/sites?scope=unlinked` lists only that
bucket. `GET /v1/sites` returns `{ sites, limit, used }`.

## Authentication data retention

The production Worker runs once each 5 minutes. Each run delivers pending remote
authorization events and cleans up hosted sites. Both are retry paths: a request
schedules its own first attempt, so a run only repeats what failed. The midnight UTC run also deletes
expired or consumed email challenges, expired or revoked sessions, expired or
consumed team authentication tickets, and expired rate-limit records. A successful
retention run logs only aggregate deletion counts.

The `preview` and `test` environments do not install an automatic Cron Trigger.
To run the scheduled handler during local development, start the API and request
the Cloudflare scheduled-handler test route:

```bash
curl "http://127.0.0.1:3100/cdn-cgi/handler/scheduled?cron=*+*+*+*+*"
```

## Remote control plane

The Auth API stores remote hosts, memberships, invitations, and logical sessions.
It issues short-lived ES256 connection tickets. `/.well-known/jwks.json` publishes
the public key so the separate Signal service can verify tickets without a D1
request. The old Team Tunnel provisioning endpoint returns `426` and does not
create a Cloudflare Tunnel.

Set the private JWK, public JWKS, active key ID, Signal URL, and webhook secret in
the encrypted environment. The private and public keys must use ES256. The Signal
URL must point to a DNS-only host. Cloudflare carries only account and configuration
requests. It does not carry Team API or Remote Desktop data.

To deploy your own copy of this Worker with your own Signal, see
[Self-hosted remote access](../../docs/self-hosting.md).

### Live Activity and notification relay

`POST /v2/remote/hosts/:hostId/live-activity` forwards a sealed iPhone Live Activity update from a
host to Apple Push Notification service. The host seals the content for the phone, so the Worker
cannot read it. The Worker checks the host credential and `LIVE_ACTIVITY_RATE_LIMITER`, makes the
APNs payload itself, and stores and logs nothing. An update that shows an event that notifies the
member has an `alert` with the sound of the phone and "OpenBot" as its only text (iOS shows the text
on Apple Watch only); a host cannot give the text.

`POST /v2/remote/hosts/:hostId/notification` forwards a sealed iPhone notification in the same way.
It has its own key in `LIVE_ACTIVITY_RATE_LIMITER`, and it sends nothing for a device session that
has ended (`RemoteControlPlane.sessionOpen`), because the host does not learn about the end. The
alert has "OpenBot" as its only text and `mutable-content`; the app opens the sealed bytes.

The relay is off until `APNS_PRIVATE_KEY` (the `.p8` key text) and `APNS_KEY_ID` are set. Create
the key in Apple Developer > Keys with the Apple Push Notifications service, then add both to the
encrypted environment and to the `cloudflare-production` GitHub environment. `APNS_TEAM_ID` and
`APNS_TOPIC` are in `wrangler.jsonc`.

For local development, run `bun run dev:apns-key -- ~/Downloads/AuthKey_<KEY_ID>.p8`. It saves the
key in ignored development state. The local Worker runtime cannot open HTTP/2, which APNs requires, so `vite dev`
sets `APNS_ORIGIN` and forwards the Worker's request to Apple from Node
(`dev-apns-proxy.ts`). The Worker still checks the host and the limit, makes the payload and signs
the token. Only a loopback caller can use the forwarder, and the Worker accepts only a loopback
`APNS_ORIGIN`.

`POST /v2/remote/hosts/:hostId/android-notification` forwards a sealed Android notification to
Firebase Cloud Messaging in the same way, with the same limit and session check. The Worker sends a
data message with the sealed bytes and the sound only; the app opens the seal. The relay is off until
`FCM_SERVICE_ACCOUNT` is set: the service account key file (JSON) of the Firebase project of the app,
from Firebase console > Project settings > Service accounts > Generate new private key. Put it into
the encrypted environment as one line (`jq -c . <file>.json`) and into the `cloudflare-production`
GitHub environment. A deployment stops before remote changes when the value is not a service account
key file. The local Worker sends to Firebase directly.
