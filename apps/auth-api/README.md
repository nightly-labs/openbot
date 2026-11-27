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
the twelve storage add-on Prices (`openbot_storage_{plan}_{1|2}_{month|year}`, one Product for each
plan), the license Prices, the Polish VAT Tax Rate and the Customer Portal settings in the Stripe account of
`STRIPE_SECRET_KEY`.
It is safe to run again: a changed amount makes a new Price and moves the lookup key to it. The Portal
has no plan change (`subscription_update` is off); it cancels plans and updates payment methods.
`POST /v1/me/billing/storage` (and `/api/browser/v1/me/billing/storage`) with
`{subscriptionId, tier}` buys a storage tier for a server on a VPS of the operator. See
[Hosted servers](../../docs/hosted-servers.md#storage-tiers).
The bootstrap also creates the `openbot_credits` Product and one Price for each credit amount
(`openbot_credits_<n>`). `GET /v1/me/credits` returns the balance of the account and of its servers,
`POST /v1/me/credits/checkout` with `{credits, currency, serverId?}` opens a Checkout, and
`POST /v1/me/credits/transfer` with `{serverId, direction, credits}` moves credits between the account
and a server that it owns. `POST /v1/me/credits/redeem` with `{code, serverId?}` redeems a credit code
for the account or for a server that the account is a member of. The web client uses the same routes
under `/api/browser`. `bun run test:credits` checks them.

Make credit codes with `bun apps/auth-api/scripts/credit-codes.ts`:

```sh
bun apps/auth-api/scripts/credit-codes.ts create --credits 500 --count 200 --expires 2027-03-31 --campaign launch-week --note "Launch" --out ~/launch-codes.csv --production --confirm-production --apply
bun apps/auth-api/scripts/credit-codes.ts list --campaign launch-week --production
bun apps/auth-api/scripts/credit-codes.ts disable <code id> --production --confirm-production --apply
```

A code has 16 random characters from a 32-character alphabet (80 bits), for example
`7KQ2-M9XD-4TPA-HW3C`. The script shows each code one time. D1 keeps only the SHA-256 hash of the
code, so nobody can read a code back from the database. `--max-redemptions <m>` lets up to `<m>`
accounts redeem the same code, one time each (default 1). The credits are free credits that end
`--grant-days` days after the redemption (default 365). An account can redeem each code one time and
any number of different codes. `--count` makes up to 1000 codes in one run. `--campaign` (lower-case
letters, digits and dashes) groups codes in `list` and in the OpenPanel Credits dashboard. `--out`
writes the codes to a new CSV file with mode 0600 instead of the terminal. `disable` stops a code;
credits that accounts already redeemed stay.

Redemptions have hourly limits (`CREDIT_CODE_LIMITS` in `src/server/credit-codes.ts`): 30 tries and 10
wrong codes for each account, 120 tries and 30 wrong codes for each network address (IPv6 to its /64),
and 20 redemptions of one code from one network. Only a code that does not exist or is disabled is a
wrong code; a used, expired or already redeemed code counts only as a try. A try over a limit gets
`429 credit_code_attempts`.
D1 keeps only SHA-256 hashes of the counted keys in `credit_code_limits`, and the retention job deletes
old hours.
Without `--apply` the script makes no change. `--local` (the default) and `--test` work the same way.

Each account gets 10 welcome credits once, with no end date. They pay only for the models that the
media gateway gives a welcome route. The Worker reaches the media generation processor only through
the private Worker `openbot-media-gateway` (service binding `MEDIA_GATEWAY`, production only). D1 keeps
the models, prices, holds and ledger; the gateway keeps the adapters, routes and keys. Its source is
in the private repository [`nightly-labs/openbot-media-gateway`](https://github.com/nightly-labs/openbot-media-gateway):
change processors, routes and welcome routes there, then deploy that Worker. Without the
binding, as in local development, every credits model is unavailable. `bun run test:credit-media`
checks the service against a fake gateway.

The optional Worker variable `VIES_REQUESTER_VAT_ID` is the seller's EU VAT ID (for example
`PL1234567890`). With it, the EU VIES check of a buyer's VAT ID returns a consultation number, which the
Stripe customer keeps as proof of the check. Without it, the check works and has no number.
`bun scripts/stripe-vat-migrate.ts` moves the subscriptions that used Stripe Tax to the Tax Rate; it is
a dry run unless you give `--apply`.
The Worker variable `BILLING_COUNTRY_REQUIRED=true` refuses a Checkout of an account with no billing
country (409 `billing_country_required`). `wrangler.jsonc` sets it, so production and local development
refuse. With `false`, such an account gets a Stripe Tax Checkout, so that a desktop app older than 0.72.0
can still buy. Set `BILLING_COUNTRY_REQUIRED=false` in the shell to try that path locally.

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
deleted customer, a refund, a dispute, the welcome email of a first plan, and the storage tiers
(`storage-tier`, which needs the storage Prices of the bootstrap). The `license-*`
scenarios check the license: buy, Checkout, one open Checkout page, change users, the user count,
renewal, failed renewal, currency, isolation from the server plans, and the user limit at a join. The `credits`
scenario buys the smallest credit pack and checks the invoice: Polish VAT for PL and DE, the OSS amount for DE, and no VAT
for US. Each scenario uses a Stripe
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

The `promotion-link` scenario makes a coupon with two promotion codes in the sandbox and checks the
Checkout pages of a discount link (`?promo=CODE`): an active code is applied, and a code that does not
fit the order or does not exist gives the code field. A copy of the Brazil partner code (BRL server plans only)
gives a discount on a BRL server page and the code field on a EUR server page and a license page. It deletes the
coupons and turns off the codes at the end.

The `invite` scenario checks the invite rewards: a referred friend gets the first-payment coupon only on the
first purchase, the coupon goes after the first paid invoice, a yearly payment gives 12 credit parts 30 days
apart, the cron (`/cdn-cgi/handler/scheduled`) sends the due parts, and a refund takes the newest unsent parts
first and then the sent credit. The scenario moves `ready_at` in D1, because the parts use the Worker clock,
not the Stripe test clock.

The `portal` scenario prints a Customer Portal cancel page and waits until you use it. Then it checks
that the plan change flow of an old app opens the Portal home, and that the Portal has no plan change. The report goes to `.openbot-build/stripe-flows-e2e.json`.

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
EMAIL_SMTP_USERNAME=no_reply@openbot.run
EMAIL_SMTP_PASSWORD=<PRIVATE_EMAIL_APP_PASSWORD>
EMAIL_FROM=no_reply@openbot.run
EMAIL_REPLY_TO=hello@openbot.run
EMAIL_LICENSE_REPLY_TO=licenses@openbot.run
```

Sign-in codes, invitations and welcome emails go from `EMAIL_FROM`, the `no_reply@openbot.run`
mailbox, with `EMAIL_REPLY_TO` in `Reply-To`, so a reply goes to the team's inbox. An empty
`EMAIL_REPLY_TO` uses `EMAIL_FROM` and adds no `Reply-To`. `EMAIL_SMTP_PASSWORD` is the password of
the `EMAIL_SMTP_USERNAME` mailbox. The CI deploy reads it from the `EMAIL_SMTP_PASSWORD` secret of the
`cloudflare-production` GitHub Environment, not from `.env.production`: when the mailbox changes,
change both, at the time of the merge.

License emails (the first payment, a failed renewal payment, and the end of a license) go from
`EMAIL_LICENSE_FROM`. The SMTP account must be allowed to send as that address: on Private Email,
make it an alias of the `EMAIL_SMTP_USERNAME` mailbox. An empty value uses `EMAIL_FROM`, as production
does. A reply goes to `EMAIL_LICENSE_REPLY_TO` (`licenses@openbot.run` in production), or to the
license sender when it is empty.

When the `no_reply@openbot.run` mailbox reaches its sender limit (500 messages an hour), the email goes
again from the overflow mailbox `EMAIL_SMTP_OVERFLOW_USERNAME` (`hello@openbot.run` in production),
with that address as the sender. Its password is the `EMAIL_SMTP_OVERFLOW_PASSWORD` secret, in the
same places as `EMAIL_SMTP_PASSWORD`; it is optional, and without it the overflow mailbox is off.
When the overflow mailbox also reaches its limit, Cloudflare Email Service sends the email from
`EMAIL_FROM` (`EMAIL_FALLBACK`). Cloudflare also has a daily quota: past it, the binding refuses with
`E_DAILY_LIMIT_EXCEEDED`.

`bun run env:set:smtp` encrypts the app password into `.env.production` only.

Production does not open the SMTP socket itself. From some Cloudflare locations, such as FSD, a
socket to the mail host fails at once (#4578). The production Worker sends each email through the
`openbot-email-relay` Worker (`wrangler.email-relay.jsonc`) over the `EMAIL_RELAY` service binding.
Cloudflare places that Worker near the mail host. The relay has no route and keeps no secret: the
binding request carries the SMTP settings and the message. CI and `bun run api:deploy` deploy the
relay before the production Worker. When you change `EMAIL_SMTP_HOST` or `EMAIL_SMTP_PORT`, also
change `placement.host` in `wrangler.email-relay.jsonc`. The test Worker and local `vite dev` send
from their own socket. Workers Logs are off. To see where the relay runs, read the `colo` of its events in
`bunx wrangler tail openbot-email-relay`.

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
agent's work. The key also lets `POST /v1/feedback` open an approved bug report or feature idea from the app as
an issue in `nightly-labs/openbot`, for any signed-in account, three times a minute (`FEEDBACK_RATE_LIMITER`) and 10 times a UTC day (`feedback_daily_counts` in D1). The Worker does not store or log the text. With `sameAs`, the report is a comment on that open app issue. Before the card, `POST /v1/feedback/similar` finds open app issues with a similar title, three times a minute for each account (the same limiter, with its own key); the title is in the body, so request logs do not keep it. Each report ends with a hidden owner mark
(`feedback-owner.ts`): a random value and an HMAC of it and the account ID, with a key that HKDF derives
from the app key. `POST /v1/feedback/withdraw` takes `{ number }` and, for the account whose mark ends
the text, deletes its comments on that issue or moves its issue to `FEEDBACK_WITHDRAWN_REPOSITORY`, a
private repository where the app has Issues write access. GitHub keeps every earlier version of an
edited text, so the route never edits. Without that variable, an issue answers 503
`feedback_withdraw_unavailable`; a comment can still go. A new app key makes the earlier marks invalid.
With no key, the route answers 503, the app gives the GitHub form link instead, and the desktop acts
as the signed-in user. In GitHub Actions the secret is
`OPENBOT_GITHUB_APP_PRIVATE_KEY`, because GitHub refuses secret names that start with `GITHUB_`.
Secrets are never passed as process arguments. The other values are Worker
variables. The SMTP connection uses TLS from the start and accepts only port 465.

GitHub Actions reads the remote-control secrets, `SKILLS_ADMIN_TOKEN`, `SITE_REPORT_HASH_SECRET`, and the optional
`SITE_OPERATIONS_ADMIN_TOKEN` and `SERVER_CLAIMS_ADMIN_TOKEN` from the `cloudflare-production` Environment. It includes
them in Wrangler's temporary runtime secrets file.

Cloudflare Access also protects the admin routes (`/v1/skills/admin/`, `/v1/marketplace/agents/admin/`,
`/v1/sites/admin/` and `/v2/admin/`). When the Worker variables `CF_ACCESS_TEAM_DOMAIN` (for example
`<team>.cloudflareaccess.com`) and `CF_ACCESS_ADMIN_AUD` (the AUD tag of the Access application) are
set, an admin request needs a valid `Cf-Access-Jwt-Assertion` as well as the admin token. With only
one of them set, every admin request is refused. They are not secrets: set them in `wrangler.jsonc`
`vars` only after the Access application exists. Development keeps them empty. People sign in to
Access with MFA. Scripts send an Access service token when `CF_ACCESS_CLIENT_ID` and
`CF_ACCESS_CLIENT_SECRET` are in the environment (`scripts/cloudflare-access-headers.ts`).

`COMPANY_SIGN_IN_SECRET` (at least 32 random bytes) turns on company sign-in (OpenID Connect and
SCIM). It encrypts each company's client secret in D1, so never change or lose it: with another
value, each company must enter its client secret again. Without it, company sign-in answers 503 and
everyone signs in with an email code. GitHub Actions reads it from the `cloudflare-production`
Environment; a local deployment reads it from the encrypted `.env.production`.

`HOSTED_ARCHIVE_KEY_SECRET` (32 random bytes in base64), `B2_WORKER_KEY_ID_EU` and
`B2_WORKER_APPLICATION_KEY_EU` are set together or not at all. They are for the archives of ended
pool servers ([plan 012](../../plans/012-pool-server-archive.md)). The first encrypts the `age` key
of each archive in `hosted_server_archives`; with another value, no archive can be restored. The B2
key reads the `openbot-pool-archive-eu` bucket and nothing else. The encrypted `.env.production` has
all three, and GitHub Actions reads them from the `cloudflare-production` Environment. When you
change one, change it in both places and deploy the Worker.
`BROWSER_EXTENSION_IDS` lists the ids of the published OpenBot browser extensions, separated by
commas (a Chrome id is 32 letters from `a` to `p`). Only they get a sign-in from the web app: the
extension opens `/app?extension=<id>&challenge=<c>&state=<s>` in its sign-in window, the person
allows it, `/api/browser/extension/code` gives a one-time code, and the extension spends it with its
verifier at `/v1/mobile-auth/company/exchange` (`platform: "unknown"`), as the phone does after a company sign-in. The extension first asks with no window (`&silent=1`,
`launchWebAuthFlow` not interactive): the web app gives the code at once when this account allowed this
extension in this browser before (`openbot.web.extension-allowed.v1` in local storage), and else answers
`login_required` or `consent_required`, and the extension opens the window. Without the variable, production gives no extension a
code; a development API (`AUTH_EXPOSE_DEVELOPMENT_CODE`) accepts any extension id, because an
unpacked extension gets its id from its folder. It is not a secret: set it in `wrangler.jsonc` `vars`
when the store gives the extension its id.

`GET /v1/browser-extension/x-rules?hash=<hex>` answers the CSS selectors that the extension uses on
X (`server/browser-extension-x-rules.ts`) as `{ hash, rules }`, with `rules: null` when the extension
already has that hash. When X changes its page, put new selectors in that file and deploy: extensions
take them within an hour, with no store review. It holds selectors only, never code.

`SERVER_CLAIMS_ADMIN_TOKEN` lets an operator sign a new server in for a user without an email code: see
[server claims](../../docs/self-hosted-server.md#sign-in-with-a-server-claim). Without it, the endpoint answers 401.
The encrypted `.env.production` has it, so `scripts/hosting/leaseweb-pool.ts custom` can sign a custom
server in for its owner. GitHub Actions reads it from the `cloudflare-production` Environment. When you
change it, change it in both places and deploy the Worker.

`STORE_REVIEW_EMAIL` and `STORE_REVIEW_CODE` give app store reviewers a sign-in that does not need an
inbox. A sign-in that starts with this one email sends no email, and its code is `STORE_REVIEW_CODE`
(8 characters from the sign-in code alphabet). The expiry, the 5 tries and the rate limits stay the
same, and every other email works as before. Set both or neither: a value that is not a valid email or
code turns the sign-in off. The account must be a member of the review server only, because each person
who has the code can sign in to it. Change the code after a review. The encrypted `.env.production`
has both values, and `scripts/deploy-auth-api.ts` puts them. The CI deploy keeps the values that the
Worker has.

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

Production has a fallback: the `EMAIL_FALLBACK` `send_email` binding of Cloudflare Email Service.
When SMTP surely did not send a message (a sender limit, a refusal of the sender or the message, or
a connection that stopped before `DATA`), the Worker sends the same message through Cloudflare. It
does not fall back after `smtp_delivery_unknown`, an invalid input or configuration, or a refused
recipient. The fallback uses only the time left in the 25-second delivery budget of a sign-in code,
and it does not start with less than 2 seconds left, as after three SMTP timeouts. When
Cloudflare also fails, the answer stays the SMTP failure, so a sender limit keeps its 429. Each
fallback sends an `email_fallback_sent` analytics event. Before the first deploy with the binding,
onboard `openbot.run` in the Cloudflare dashboard under Email Sending, and keep
`allowed_sender_addresses` equal to `EMAIL_FROM` and `EMAIL_LICENSE_FROM`. The preview and test
Workers have no fallback.

The contact form on `/contact` posts to `/v1/contact`. The Worker sends each message to
`EMAIL_REPLY_TO` (or `EMAIL_FROM` when it is empty) through SMTP, with the visitor's address in `Reply-To`, and stores nothing.
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
against the server's limit: a `server_site_limits` row, else its plan's limit, else the account's shared
pool (3 sites for each license user, else 1), within an account cap of 300. A wrong token gets 401
`host_unauthorized`. Without them, a new site goes into the account's unlinked bucket of one site;
`GET /v1/sites?scope=unlinked` lists only that bucket. `GET /v1/sites` returns `{ sites, limit, used }`, plus an optional `limitReason`: `shared` for a
server in the shared pool, `account` when the account cap is full.

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

Two optional variables spread hosts over more than one Signal machine. When both are empty, each
ticket names `REMOTE_SIGNAL_URL`, as before.

- `REMOTE_SIGNAL_HOMES`: the Signal machines that a host can have as its home, as `id=url,id=url`,
  for example `a=wss://signal-a.openbot.run/v1/signal,b=wss://signal-b.openbot.run/v1/signal`. An ID
  has 1 to 32 characters from `a-z`, `0-9` and `-`. A URL must use `wss:`, or `ws:` when
  `REMOTE_SIGNAL_URL` uses `ws:`. An invalid value makes each ticket request fail with
  `503 remote_not_configured`. A host ticket request with `signalHome: true` gets a home, which
  `remote_hosts.signal_home` keeps, and a ticket with the `signal` claim. The host keeps its home
  until it sends that home's URL as `failedSignalUrl`. Session tickets of the host name the same
  home. Other host tickets (ingress, the webhook relay, released hosts) and hosts with no home use
  `REMOTE_SIGNAL_URL`, which stays the entry Signal. A host ticket request with `signalHome: true` can
  also send `preferredSignalHome`, the ID of the home that an owner or admin chose. The host gets that
  home when it is not the `failedSignalUrl` and its `/health/ready` answers in 2 seconds; otherwise the
  rules below choose. An ID that is not a home is ignored. `POST /v2/remote/hosts/:hostId/signal-homes`
  with the machine token lists the homes (`{ homes: [{ id, url }] }`).
- `REMOTE_SIGNAL_HOME_LOCATIONS`: the place of each home, as `id=latitude:longitude,...`, for example
  `a=60.17:24.94,us=37.34:-121.89`. Empty means no places. Otherwise it must name each home of
  `REMOTE_SIGNAL_HOMES` one time, or each ticket request fails with `503 remote_not_configured`. With
  places, a host gets one of the homes at most 1000 km farther from it than the nearest home, from the
  Cloudflare request location. A host keeps its home while that home is near; otherwise it moves at its
  next ticket. The variable has no effect when `REMOTE_SIGNAL_HOMES` is empty.
- `REMOTE_SIGNAL_HOME_COUNTRIES`: the homes of the hosts in a country, as `CC=id+id,...` with the
  Cloudflare country code (`request.cf.country`), for example `CN=us+au`. A host in a listed country
  gets one of its homes by the same hash, and the distance rule does not apply to it. When its home
  fails, the host moves to another home of its country; when its country has no other home, the
  distance rule chooses. A host reports only one failed home, so with two homes that are both down it
  goes between them, as with the distance rule. Empty means the distance rule for each
  country. Each ID must be a home of `REMOTE_SIGNAL_HOMES`, or each ticket request fails with
  `503 remote_not_configured`, so remove a home from this list in the same deploy. Use it where the
  network routes do not follow the map. The variable has no effect when `REMOTE_SIGNAL_HOMES` is empty.
- `REMOTE_AUTH_WEBHOOK_URLS`: each Signal that gets the auth events, as `url,url`. Empty means
  `REMOTE_AUTH_WEBHOOK_URL` only. The outbox deletes an event when each URL accepted it, and sends it
  again only to the URLs that failed.
- `SIGNAL_ENTRY_ZONE_ID` and the secret `SIGNAL_ENTRY_DNS_TOKEN`: with both and two homes, the cron
  `*/1 * * * *` moves the `REMOTE_SIGNAL_URL` name to another home when its machine stops answering
  `/health/ready` (`src/server/signal-entry-failover.ts`). The token needs only `Zone.DNS:Edit` on that
  zone. The test and preview Workers keep the zone empty, so they never change production DNS.

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

`POST /v2/remote/watch/sessions` pairs an Apple Watch with the phone account session that sends it
(`watch_sessions` in D1). The body is `{ publicKey }`, the raw P-256 key of the watch. The answer is
`{ watchSessionId, token, expiresAt }`; D1 keeps only the hash of the token. The watch session ends
after 30 days, or when its phone session ends. The same key again replaces the old session, and an
account keeps at most 5. `DELETE /v2/remote/watch/sessions/:watchSessionId` revokes one.
`POST /v2/remote/watch/ticket` takes the watch token and a signed `{ hostId, ts, proof }`, checks the
membership on the host, and gives an ES256 ticket with `aud: "openbot-watch"` from the remote ticket
key. `WATCH_TICKET_RATE_LIMITER` limits each watch session to 30 tickets a minute.

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
