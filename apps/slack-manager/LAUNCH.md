# Launch OpenBot agents in Slack (production)

Status on 2026-09-30, and the steps that remain. Do the steps in this order.

Related documents: `docs/slack-manager-app.md` (full requirements),
`docs/slack-in-production.md` (user flow), `docs/messaging.md` (user guide).

## Status

| Item | State |
| --- | --- |
| Slack CLI login | `hello` in `openbotdev` (`T0C5B1XG542`) |
| Production manager app | `OpenBot`, `A0C5H5C95NH`, no scopes yet |
| Development manager app | `OpenBot (dev)`, `A0C5G5XGS83`, no scopes yet |
| Old apps (`openbot-dev`, `T0C5443H7CP`) | `A0C5K4J6AUW`, `A0C5QNZTWLC`: not used, not deleted |
| Manager scopes | Refused: `illegal_user_scopes` for `app_configurations:read,write` |
| Code | On branch `slack-messaging`. Not merged to `main`. |
| Worker Slack secrets | Not in `apps/auth-api/.env.production` |
| Signal with Slack ingress | Not deployed |

## 1. Get Slack enrollment (blocks all other production steps)

There is no self-serve switch. Slack must enable "manager app support" on the home team.

- [ ] Send the request through https://my.slack.com/help/requests/new (or the Slack Partner
      Program, if you are a Salesforce partner). Give:
  - Home team `T0C5B1XG542` (`openbotdev`)
  - Apps `A0C5H5C95NH` (production) and `A0C5G5XGS83` (development)
  - User scopes `app_configurations:read`, `app_configurations:write`
  - Use case: the desktop host creates one Slack app for each agent with `apps.manifest.create`.
    Redirect URL `https://api.openbot.run/v2/slack/manager/callback`.
- [ ] Get these answers from Slack in writing:
  - Do we also need `managed_apps:install`? (Slack docs name apps with this scope "manager apps".)
  - The limit of managed apps for each manager app (`managed_app_limit_reached`).
  - Does the manager user token expire or rotate?
  - Does `apps.icon.set` work with the manager user token?
  - Does `apps.manifest.create` check the request URL before it returns?
  - Must a workspace that requires app approval also approve the `OpenBot` manager app?

## 2. Apply the manifests (after enrollment)

```sh
cd apps/slack-manager/production
slack manifest validate --app A0C5H5C95NH
slack manifest sync --app A0C5H5C95NH

cd ../development
slack manifest validate --app A0C5G5XGS83
slack manifest sync --app A0C5G5XGS83
```

- [ ] Both validate with no `illegal_user_scopes` error.

## 3. Manual app settings (`slack app settings --app <id>`)

For each app:

- [ ] **Manage Distribution**: turn on public distribution.
- [ ] **Basic Information**: set the icon and the short description.
- [ ] Privacy policy URL and support URL, if Slack asks for them.
- [ ] Copy the client ID and client secret (step 4). Do not install the app in `openbotdev`.
- [ ] Do not list the app in the Slack Marketplace. It is not necessary for OAuth install.

## 4. Worker secrets (`apps/auth-api`)

Without these, the Slack routes return `503 slack_not_configured`. Set them in test first, with the
development app, then in production, with the production app.

| Name | Kind | Value |
| --- | --- | --- |
| `SLACK_MANAGER_CLIENT_ID` | variable | Manager app client ID |
| `SLACK_MANAGER_CLIENT_SECRET` | secret | Manager app client secret |
| `SLACK_STATE_SECRET` | secret | Random, 32 bytes or more |
| `SLACK_ROUTE_PRIVATE_JWK` | secret | New ES256 private JWK (see below) |
| `SLACK_ROUTE_KEY_ID` | variable | For example `openbot-slack-route-1` |
| `REMOTE_TICKET_PUBLIC_JWKS` | secret (update) | Add the route **public** JWK beside the ticket key |

Make the route key:

```sh
bun -e 'import { exportJWK, generateKeyPair } from "jose";
const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
const kid = "openbot-slack-route-1";
console.log(JSON.stringify({ ...(await exportJWK(privateKey)), kid, alg: "ES256" }));
console.log(JSON.stringify({ ...(await exportJWK(publicKey)), kid, alg: "ES256", use: "sig" }));'
```

Keep the route key separate from the ticket key. The route token has no expiry and is in the request
URL of every agent app. A rotation must update the manifest of every agent app.

- [ ] Test Worker: `bun run deploy:test` (in `apps/auth-api`).
- [ ] Production Worker: `bun run deploy` (in `apps/auth-api`), after step 7 passes.
- [ ] `https://api.openbot.run/slack/connect` serves the page.

## 5. Signal (`remote/`), before any desktop release with Slack

An old Signal closes a socket that sends an unknown frame type. Deploy Signal first.

- [ ] Deploy Signal from `slack-messaging` (see `docs/remote-session-deployment.md`; host
      `sui-alexandria`, `/opt/openbot/remote`).
- [ ] Deploy the new `remote/nginx/signal.openbot.run.conf`. The `/v1/slack/` block turns off the
      access log, caps the body at 64 KB and sets 5 s timeouts.
- [ ] If Signal reads `REMOTE_TICKET_PUBLIC_KEYS` and not the Worker JWKS URL, add the route
      public key there too.

## 6. Merge and release the desktop app

- [ ] Open a PR for `slack-messaging`. It adds a database migration: CI runs the schema parity and
      data-preservation tests.
- [ ] Merge after Signal (step 5) is live.
- [ ] Release a desktop version (`release-upgrade-safety` audit first).

## 7. End-to-end test (test Worker + development app, then production)

Use a separate test workspace, not `openbotdev`.

- [ ] **Agent settings → Slack → Connect Slack**: consent page for the manager app, then "Connected to
      <workspace>".
- [ ] Add two agents: each gets its own Slack app, install page opens, state becomes **Connected**, icon
      becomes the agent avatar.
- [ ] Mention each agent in a public channel and send each a DM. Each answer comes from the correct
      bot user, in the thread (👀 → "Working on it…" → answer → ✅).
- [ ] Approval request: **Approve** / **Deny** work only for the person who asked.
- [ ] Rename an agent: the Slack app name changes.
- [ ] Disconnect an agent: its Slack app is deleted.
- [ ] Quit OpenBot, send a message, start OpenBot in less than 5 minutes: the message gets an answer.
- [ ] Nginx and Signal logs show no route token and no message text.

## Limits to know

- Free Slack workspace: 10 apps maximum, so 10 agents maximum.
- A workspace with app approval keeps the agent in "Waiting for install" until an admin approves.
- Only the host desktop can add an agent to Slack. A joined server or the web client can pause,
  reconnect, disconnect and read.
- Slack retries an event at about 0, 1 and 5 minutes, then drops it.

## Not confirmed

- `docs/slack-manager-app.md` says `apps.manifest.create` returns `invalid_manager_app` before
  enrollment. On 2026-09-30, `apps.manifest.validate` returned `illegal_user_scopes`. I did not test
  `apps.manifest.create` with a manager user token, because none exists yet.
- The Signal key source (`REMOTE_TICKET_PUBLIC_KEYS` or Worker JWKS): I did not check the production
  Signal configuration.
