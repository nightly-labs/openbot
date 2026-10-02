# Self-hosted remote access

This guide tells you how to run your own account service (the Account API Worker), Signal and TURN
for remote access. Use it when you do not want `api.openbot.run` and `signal.openbot.run` to carry
your account and connection set-up.

Our Worker does not issue a ticket for another Signal. A ticket gives access to a host, and our key
signs it, so a ticket for your Signal would also open our Signal. Thus a self-hosted Signal needs a
self-hosted account service with its own keys. See
[issue #1263](https://github.com/nightly-labs/openbot/issues/1263).

## What changes

- Accounts on your service are separate from accounts on `openbot.run`. Each person signs in again.
- Each desktop and phone that connects to a host must use the same service.
- Invitations are `openbot://join` links. Copy a link from the app and send it yourself. An email
  invitation from the app does not work.
- On iPhone, paste or scan the invitation link. A tapped `openbot://` link does not open the app.
- The browser client at `openbot.run/app` does not work with your service.
- Hosted servers, the OpenBot GitHub App, Slack and the iPhone Live Activity relay stay off. Each
  needs secrets that only we have.
- The other network connections in [PRIVACY.md](../PRIVACY.md) do not change.

## What you need

- A Cloudflare account with Workers, D1 and R2, and a domain on Cloudflare.
- A Linux server with Docker Engine, Docker Compose and a static public IPv4 address. See the
  [Signal production requirements](../remote/README.md#production-requirements) for ports and DNS.
- An SMTP account that accepts TLS on port 465. Sign-in sends a one-time code by email.
- A clone of the OpenBot release that you run, and [Bun](https://bun.sh).

In the examples, the account service is `api.example.com`, Signal is `signal.example.com` and TURN is
`turn.example.com`. Use your own names.

## 1. Make the keys

Run this command from the repository root. It prints the ticket key pair:

```sh
bun -e 'const { generateKeyPairSync } = require("node:crypto"); const kid = "self-hosted-1"; const meta = { kid, alg: "ES256", use: "sig" }; const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" }); console.log(`REMOTE_TICKET_KEY_ID=${kid}`); console.log(`REMOTE_TICKET_PRIVATE_JWK=\x27${JSON.stringify({ ...privateKey.export({ format: "jwk" }), ...meta })}\x27`); console.log(`REMOTE_TICKET_PUBLIC_JWKS=\x27${JSON.stringify({ keys: [{ ...publicKey.export({ format: "jwk" }), ...meta }] })}\x27`);'
```

Make each other secret with `openssl rand -base64 48`:

| Secret | Where |
| --- | --- |
| `REMOTE_AUTH_WEBHOOK_SECRET` | Worker and Signal. Use the same value on both. |
| `SKILLS_ADMIN_TOKEN`, `SITE_REPORT_HASH_SECRET` | Worker |
| `REMOTE_SESSION_SECRET`, `TURN_SHARED_SECRET`, `REMOTE_METRICS_TOKEN` | Signal |

Keep the private JWK secret. With it, a person can open each host that uses your service.

## 2. Deploy the account service

1. Install the dependencies and sign in to Cloudflare:

   ```sh
   bun install --frozen-lockfile
   cd apps/auth-api
   bunx wrangler login
   bunx wrangler d1 create openbot-auth
   bunx wrangler r2 bucket create openbot-avatars
   bunx wrangler r2 bucket create openbot-skills
   bunx wrangler r2 bucket create openbot-sites
   ```

2. Edit the top level of `apps/auth-api/wrangler.jsonc`. Do not change the `env` section.
   - `routes`: replace both entries with `{ "pattern": "api.example.com", "custom_domain": true }`.
   - `d1_databases`: set `database_id` to the ID that `d1 create` printed.
   - `r2_buckets`: set the bucket names, if you used other names.
   - `vars`:
     - `EMAIL_SMTP_HOST`, `EMAIL_SMTP_PORT`, `EMAIL_SMTP_USERNAME`, `EMAIL_FROM`: your SMTP account.
     - `REMOTE_TICKET_KEY_ID`: the key ID from step 1.
     - `REMOTE_SIGNAL_URL`: `wss://signal.example.com/v1/signal`.
     - `REMOTE_AUTH_WEBHOOK_URL`: `https://signal.example.com/internal/auth-events`.
     - `HOSTED_SERVERS_ENABLED`: `"false"`.

3. Put the Worker secrets in `apps/auth-api/.env.self-hosted`. Git ignores this file name.

   ```sh
   EMAIL_SMTP_PASSWORD=...
   SKILLS_ADMIN_TOKEN=...
   SITE_REPORT_HASH_SECRET=...
   REMOTE_TICKET_PRIVATE_JWK='{"kty":"EC",...}'
   REMOTE_TICKET_PUBLIC_JWKS='{"keys":[...]}'
   REMOTE_AUTH_WEBHOOK_SECRET=...
   ```

4. Deploy. The script puts the secrets, applies the D1 migrations, builds and deploys the Worker:

   ```sh
   bunx dotenvx run -f .env.self-hosted -- bun ../../scripts/deploy-auth-api.ts
   ```

5. Check the service. Each command must return `200`:

   ```sh
   curl -fsS https://api.example.com/health/live
   curl -fsS https://api.example.com/.well-known/jwks.json
   ```

## 3. Start Signal and TURN

1. Copy `remote/.env.example` to `remote/.env.self-hosted` and set these values:
   - `SIGNAL_DOMAIN`, `TURN_DOMAIN`, `TURN_PUBLIC_IP`, `ACME_EMAIL`.
   - `CLOUDFLARE_DNS_API_TOKEN`: a token with DNS edit access to your zone, for the certificates.
   - `REMOTE_TICKET_JWKS_URL`: `https://api.example.com/.well-known/jwks.json`.
   - `REMOTE_CONTROL_PLANE_URL`: `https://api.example.com`.
   - The Signal secrets from step 1.
   - Leave `SLACK_SIGNING_SECRET` empty.

   If a reverse proxy already uses port 443, also set the values in
   [the reverse proxy notes](../remote/README.md#production-requirements).

2. Start the services and check Signal:

   ```sh
   docker compose -f remote/compose.yaml --env-file remote/.env.self-hosted up -d --build
   curl -fsS https://signal.example.com/health/ready
   ```

## 4. Start the app

Do these steps on each computer that hosts or connects.

1. If you signed in to `openbot.run` before, sign out in the app. Otherwise the app sends the old
   session token to your service.
2. Quit the app. Then start it with the two variables. `OPENBOT_REMOTE_SIGNAL_URL` must be equal to
   the `REMOTE_SIGNAL_URL` of your Worker.

   macOS:

   ```sh
   OPENBOT_AUTH_API_URL=https://api.example.com \
   OPENBOT_REMOTE_SIGNAL_URL=wss://signal.example.com/v1/signal \
   /Applications/OpenBot.app/Contents/MacOS/OpenBot
   ```

   Linux:

   ```sh
   OPENBOT_AUTH_API_URL=https://api.example.com \
   OPENBOT_REMOTE_SIGNAL_URL=wss://signal.example.com/v1/signal \
   ./OpenBot-<version>-x86_64.AppImage
   ```

   Windows (PowerShell):

   ```powershell
   $env:OPENBOT_AUTH_API_URL = "https://api.example.com"
   $env:OPENBOT_REMOTE_SIGNAL_URL = "wss://signal.example.com/v1/signal"
   & "$env:LOCALAPPDATA\Programs\OpenBot\OpenBot.exe"
   ```

3. Sign in with an email address. The code comes from your SMTP account.
4. To connect an iPhone, scan the connection QR code from the desktop app. The phone then uses the
   service of that desktop.

Set the variables each time that you start the app. Without them, the app uses `openbot.run` and
sends your session token there. To go back to `openbot.run`, sign out first.

The app does not start, and shows an error, if `OPENBOT_REMOTE_SIGNAL_URL` is not a `wss:` URL, has
a user name or password, or is set without `OPENBOT_AUTH_API_URL`.

## Updates

After each OpenBot update, pull the same release, keep your `wrangler.jsonc` changes and deploy the
Worker again. The deploy applies the new D1 migrations. Then rebuild Signal with the same
`docker compose` command.
