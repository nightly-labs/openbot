# Launch OpenBot in Slack (production)

Checked against Slack docs and the Slack API Terms of Service on 2026-09-30. Sources are at the end.

## The design

One Slack app, `OpenBot`, for every workspace. A workspace installs it one time from OpenBot
(**Server settings → Connectors → Slack → Connect Slack**), and the workspace is linked to that
OpenBot server. People mention @OpenBot in a channel or send it a direct message. The Slack
Orchestrator, an agent that the connect dialog adds, receives each new request, gives the work to the
agent that fits best, and posts the answer in the thread. Every answer comes from OpenBot, with the
OpenBot name and icon.

This needs no Slack approval to work: it uses only normal bot scopes. The design that gave each agent
its own app needed Slack's manager-app enrollment, which is only for Slack partners, so it is gone.

## What you need before a public launch

1. **Permission to distribute commercially.** The API Terms forbid commercial distribution "unless
   you are authorized to do so under a separate agreement with Slack". This includes "a free App that
   connects to a paid product or service". OpenBot has paid plans, so this applies. There are two
   ways to get it:
   - **The Slack Marketplace** (Marketplace Agreement and review). Slack does not charge for it.
   - **A partner agreement** with Slack or Salesforce.
2. **For the Marketplace:**
   - [ ] At least 10 active workspaces and 10 weekly active users. Get them with an unlisted pilot
         first: the docs allow unlisted apps "for development and testing".
   - [ ] A public landing page with an Add to Slack path, a privacy policy, and support that answers
         in 2 business days.
   - [ ] AI disclosures: the model, data retention, tenancy and residency; a disclaimer that answers
         can be wrong; no training on Slack data.
   - [ ] Ask Slack before you submit: the guidelines list apps that "enable remote execution on a
         server via a downloadable third party script e.g terminal commands from Slack" as not
         suitable. OpenBot agents run tools on the user's computer from a Slack message.

Until the Marketplace approves the app, `conversations.replies` gives 1 request per minute and 15
messages. OpenBot reads the thread as context with a 5 second limit, so answers still work, with less
context.

## Rollout

What the workflows do, checked on 2026-10-01:

- **Worker.** CI job `deploy-production` (`.github/workflows/ci.yml`) runs on every push to `main`. It
  applies the D1 migrations, then deploys with `--secrets-file`. The file holds only GitHub Actions
  secrets of the `cloudflare-production` environment, and it has no Slack secret. Wrangler adds those
  secrets to the existing ones and deletes none, so the Slack secrets that `bun run deploy`
  (`scripts/deploy-auth-api.ts`, from the Dotenvx `.env.production`) uploads stay.
- **But** `REMOTE_TICKET_PUBLIC_JWKS` is in that file. Each CI deploy writes the GitHub secret's value,
  which was last changed on 2026-08-31 and does not have the Slack route key. Signal then refuses every
  route ticket.
- **Signal.** No workflow. `docs/remote-session-deployment.md` deploys it by hand over SSH. The release
  links the server's own `/opt/openbot/remote/.env.production`; the archive leaves out `.env*`. The
  `SLACK_SIGNING_SECRET` in this repository does not reach the server by itself.
- **Desktop.** `release.yml` on a version tag.

Live state on 2026-10-01: `api.openbot.run/.well-known/jwks.json` lists only `openbot-remote-1`.
`/v2/slack/authorize`, `/v2/remote/slack-route/validate` and `signal.openbot.run/v1/slack/events`
return 404.

Do the steps in this order:

1. **GitHub secret.** Set `REMOTE_TICKET_PUBLIC_JWKS` in the `cloudflare-production` environment to the
   decrypted value from `apps/auth-api/.env.production`. It lists `openbot-remote-1` and
   `openbot-slack-route-1`.
2. **Merge** the `slack-messaging` PR. CI applies D1 migration `0025` and deploys the Worker.
3. **Worker Slack secrets**, one time: `bun run api:deploy` from `main`. It uploads `SLACK_CLIENT_ID`,
   `SLACK_CLIENT_SECRET`, `SLACK_STATE_SECRET`, `SLACK_ROUTE_PRIVATE_JWK` and `SLACK_ROUTE_KEY_ID`.
   Check:
   - [ ] `jwks.json` lists `openbot-slack-route-1`.
   - [ ] `POST /v2/slack/authorize` without a session gives 401, not 404 or 503.
   - [ ] `POST /v2/remote/slack-route/validate` without a signature gives 401.
4. **Signal**, after the Worker: Signal asks `/v2/remote/slack-route/validate` for 5 minutes after it
   starts, so an older Worker makes every `ingress` hello fail.
   - [ ] Set `SLACK_SIGNING_SECRET` in the server's `/opt/openbot/remote/.env.production` with the
         server's Dotenvx key, as `A0C5H5C95NH:<production secret>,A0C5G5XGS83:<development secret>`.
         Signal binds each secret to its app. A value without app IDs turns the Slack route off (503).
         The encrypted value in `remote/.env.production` here has the old form, without app IDs:
         set it again. Not checked: whether the repository file and the server file use the same key
         pair.
   - [ ] Deploy as `docs/remote-session-deployment.md` says, with `remote/nginx/signal.openbot.run.conf`.
   - [ ] `POST https://signal.openbot.run/v1/slack/events` without a signature gives 401, not 404 or
         503.
5. **Slack app settings** for `A0C5H5C95NH`:
   - [ ] Verify the request URL in **Event Subscriptions** and **Interactivity**.
   - [ ] **Manage Distribution**: turn on distribution, unlisted, for the pilot.
6. **Desktop.** Run `release-upgrade-safety`, then release. An old Signal refuses the new `ingress`
   hello, so step 4 comes first.

The test Worker (`bun run deploy:test`) reads `.env.shared`, then `.env.production`. `.env.shared` has
no route key, so it takes the production route key and JWKS. This computer has no key for
`.env.shared`.

## End-to-end test

First with the test Worker and the development app, in a separate workspace:

- [ ] Turn on distribution for the development app, so the test workspace can install it.
- [ ] **Connect Slack**: Slack's install page, then the workspace shows **Connected**.
- [ ] OpenBot joins every public channel. Mention @OpenBot in one, and send it a direct message. The
      orchestrator answers or asks a teammate, and the answer comes in the thread.
- [ ] A follow-up in the same thread goes to the same agent.
- [ ] **Approve** and **Deny** work only for the person who asked. **Stop** stops the turn.
- [ ] Before **Add agent**: Slack answers "No agent can answer here yet". After it: the orchestrator answers.
- [ ] Quit OpenBot, send a message, start OpenBot within 5 minutes: the message gets an answer.
- [ ] Uninstall the app in Slack: the workspace shows **Token not accepted**. Connect it again: the
      old threads keep their agents.
- [ ] **Disconnect**: the token is revoked, and Signal no longer routes the workspace here.
- [ ] Nginx and Signal logs show no message text.

Then the same with production, in the unlisted pilot.

## Open questions for Slack

- Must a workspace with app approval approve OpenBot before **Connect Slack** works? The docs do not
  say. The approval flow is Slack's usual one for any app.
- The manifest docs say a `request_url` must be verified manually. Signal answers Slack's
  `url_verification`, so the check in the app settings passes. Confirm that a `manifest sync` keeps
  events flowing with no manual step.

## Status

| Item | State |
| --- | --- |
| Slack CLI login | `hello` in `openbotdev` (`T0C5B1XG542`) |
| Apps | `A0C5H5C95NH` (production), `A0C5G5XGS83` (development). OpenBot manifest and icons applied on 2026-10-01. Distribution off. |
| Old apps | `A0C5K4J6AUW`, `A0C5QNZTWLC` in `openbot-dev` (`T0C5443H7CP`). Not used, not deleted. |
| Code | #1152 merged on 2026-10-01 (`e9c04806`). No desktop release has it yet. |
| Worker | Deployed by CI with D1 `0025`. Slack secrets set, and the JWKS lists `openbot-slack-route-1`. GitHub `REMOTE_TICKET_PUBLIC_JWKS` has the route key. |
| Signal | Release `e9c04806` on `sui-alexandria`, with `SLACK_SIGNING_SECRET` for both apps and the `/v1/slack/` nginx block. Rollback image `openbot-remote-api:before-slack`. |
| End-to-end | A dev build of `main` connected a workspace on production on 2026-10-01 and answered in Slack. The `openbot://` return reached the installed release, so the link was sent to the dev app by hand. |
| Not done | Request URL check in the production app settings, distribution, device checks after the Signal restart, desktop release. |

## Sources

- Distribution: https://docs.slack.dev/app-management/distribution
- Rate limits for non-Marketplace apps:
  https://docs.slack.dev/changelog/2025/05/29/rate-limit-changes-for-non-marketplace-apps
- Marketplace guidelines:
  https://docs.slack.dev/slack-marketplace/slack-marketplace-app-guidelines-and-requirements
- Marketplace review: https://docs.slack.dev/slack-marketplace/distributing-your-app-in-the-slack-marketplace
- API Terms of Service, "Commercial Distribution": https://slack.com/terms-of-service/api
- Manifest `request_url`: https://docs.slack.dev/reference/app-manifest
- Manager apps (the design this replaces): https://docs.slack.dev/reference/scopes/managed_apps.install
