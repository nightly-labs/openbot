# OpenBot Auth API

This TanStack Start and Solid 2 package is the central OpenBot account API. It
runs on Cloudflare Workers, stores account and authentication records in D1,
and stores account avatars in R2. Users sign in with an eight-character
one-time email code. D1 stores hashes instead of plaintext codes, session tokens,
and team authentication tickets.

## Local development

`.env.dev` is generated, not committed. `bun run dev` and `bun run dev:api` call
`scripts/development-secrets.ts`, which writes one on first run: a fresh ES256
ticket key pair plus random admin, report and webhook secrets, all local to the
checkout. Nothing in it is shared with production or with another machine, so a
fork needs no key from anyone. Delete the file and rerun to get a fresh set.

`.env.shared` holds encrypted development values that all maintainers share: the Stripe
sandbox keys, the development `BOAT_API_KEY`, and the webhook secrets of the `test` Worker. The boat key creates real
VMs, but only when the Worker also has `HOSTED_SERVER_TEMPLATE`. `wrangler.jsonc` sets
`HOSTED_SERVERS_ENABLED` to `true` and `HOSTED_SERVERS_ALLOWED_USER_IDS` to `*`, so a local Worker
with a template lets each local account create one; put account IDs in `.env.dev` to limit it. A VM
cannot reach a local Worker, so use `bun run dev --hosting=test` for a real server (see
[Real servers from a development build](../../docs/hosted-servers.md#real-servers-from-a-development-build)). `bun run dev:api` decrypts it in memory. Ask a maintainer for
`DOTENV_PRIVATE_KEY_SHARED`, then export it in your shell profile or add it to the root
`.env.keys`. The shell profile works in every worktree. Without the key, the Worker runs with no
Stripe or boat keys. A value in `.env.dev` overrides the shared value. To change a value, run
`bunx dotenvx set <NAME> <value> -f apps/auth-api/.env.shared -fk .env.keys`.

### Stripe sandbox

`bun run api:stripe:bootstrap` creates the six plan Prices (lookup keys `openbot_{plan}_{month|year}`)
and the Customer Portal settings in the Stripe account of `STRIPE_SECRET_KEY`. It is safe to run
again: a changed amount makes a new Price and moves the lookup key to it. In the Portal, an upgrade
is charged at once, and a downgrade or a shorter interval starts at the next period.

For a local Worker, forward the webhooks and put the secret that `stripe listen` prints in your
own `.env.dev` as `STRIPE_WEBHOOK_SECRET`:

```bash
stripe listen --forward-to http://127.0.0.1:3100/v1/stripe/webhook
```

For the `test` Worker, `bun run hosting:setup --target=test` makes or updates its Stripe and boat
webhooks and writes their signing secrets to `.env.shared`. Then run `bun run api:deploy:test`. It
also sets the allow list from `HOSTED_SERVERS_TEST_ALLOW_LIST` and the developer key
`HOSTED_SERVERS_DEVELOPER_KEY` from `.env.shared`.

`scripts/stripe-flows-e2e.ts` checks the plan flows against the sandbox and a local Worker: renewal,
failed renewal, cancel at the period end, plan change, renew, delete, another account's server, and a
deleted customer. Each scenario uses a Stripe test clock and deletes it at the end. Start the Worker
with `HOSTED_SERVERS_ENABLED=true`, `HOSTED_SERVERS_ALLOWED_USER_IDS` set to the output of
`bun scripts/stripe-flows-e2e.ts --print-user-ids`, and `BOAT_API_KEY=e2e-invalid-key`, and forward
the webhooks to it. A value in the shell overrides `.env.shared`; without the fake key, each paid
scenario creates a real boat VM. Then, from the
repository root:

```bash
bunx dotenvx run -q -f apps/auth-api/.env.shared -fk .env.keys -- \
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

`bun run api:deploy:test` reads `.env.shared` before `.env.production`. The first file wins, so the
test Worker gets the sandbox keys, never live keys.

`.env.production` is the only encrypted production file, and its private key stays in the
ignored root `.env.keys`. Dotenvx decrypts it only in process memory, and only
the deploy and secret-rotation commands read it.

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

Commit `.env.production`. Never commit `.env.keys` or `.env.dev`.

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

## Email delivery

Private Email SMTP is the primary delivery method. Use a separate app password.
Do not use the mailbox password.

Local development sends no email at all. `.env.dev` blanks all five SMTP
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
`wrangler secret put` through standard input. It then builds and deploys the Worker.
Secrets are never passed as process arguments. The other values are Worker
variables. The SMTP connection uses TLS from the start and accepts only port 465.

GitHub Actions reads the remote-control secrets, `SKILLS_ADMIN_TOKEN`, `SITE_REPORT_HASH_SECRET`, and the optional
`SITE_OPERATIONS_ADMIN_TOKEN` from the `cloudflare-production` Environment. It includes them in Wrangler's temporary
runtime secrets file.

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

## Cloudflare deployment

Create the D1 database and replace the placeholder `database_id` in
`wrangler.jsonc`. Apply remote migrations and set delivery secrets through
Wrangler. Then deploy the Worker.

```bash
bun run api:migrate:remote
bun run api:deploy
```

The service applies limits per email, per IP, per challenge, and per resend.

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
