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

## Steps you can do now

1. **Slack app settings** (`apps/slack-app/README.md`). For `A0C5H5C95NH` and `A0C5G5XGS83`:
   - [ ] Copy the client ID, client secret and signing secret (steps 2 and 3).
2. **Worker secrets** (`apps/auth-api`). Without them, the Slack routes return
   `503 slack_not_configured`. Use the development app for test and the production app for
   production.

   | Name | Kind | Value |
   | --- | --- | --- |
   | `SLACK_CLIENT_ID` | variable | The app's client ID |
   | `SLACK_CLIENT_SECRET` | secret | The app's client secret |
   | `SLACK_STATE_SECRET` | secret | Random, 32 bytes or more |
   | `SLACK_ROUTE_PRIVATE_JWK` | secret | New ES256 private JWK |
   | `SLACK_ROUTE_KEY_ID` | variable | For example `openbot-slack-route-1` |
   | `REMOTE_TICKET_PUBLIC_JWKS` | secret (update) | Add the route public JWK beside the ticket key |

   Signal reads keys from `REMOTE_TICKET_JWKS_URL` (`api.openbot.run/.well-known/jwks.json`), which
   serves `REMOTE_TICKET_PUBLIC_JWKS`, so the Worker update covers Signal too. Make the key pair:

   ```sh
   bun -e 'import { exportJWK, generateKeyPair } from "jose";
   const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
   const kid = "openbot-slack-route-1";
   console.log(JSON.stringify({ ...(await exportJWK(privateKey)), kid, alg: "ES256" }));
   console.log(JSON.stringify({ ...(await exportJWK(publicKey)), kid, alg: "ES256", use: "sig" }));'
   ```

   - [ ] Apply D1 migration `0025_slack_workspace_routes.sql` (the CI deploy does this first).
   - [ ] Test: `bun run deploy:test`. Production: `bun run deploy`.
3. **Signal** (`remote/`). Deploy it before any desktop release with Slack: an old Signal refuses the
   new `ingress` hello.
   - [ ] Set `SLACK_SIGNING_SECRET` in `remote/.env.production` (Dotenvx).
   - [ ] Deploy Signal (`docs/remote-session-deployment.md`) and `remote/nginx/signal.openbot.run.conf`.
4. **Manifests.** Applied on 2026-10-01 with `apps.manifest.update` (`slack manifest sync` needs an
   installed app). After Signal serves `/v1/slack/events`:
   - [ ] Verify the request URL in each app's **Event Subscriptions** and **Interactivity** pages.
5. **Desktop.**
   - [ ] Open a PR for `slack-messaging`. It changes the unreleased database migration 25.
   - [ ] Merge after Signal is live. Run `release-upgrade-safety`, then release.

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
| Apps | `A0C5H5C95NH` (production), `A0C5G5XGS83` (development). OpenBot manifest and icons applied on 2026-10-01. Request URL not verified (Signal not deployed). Distribution off. |
| Old apps | `A0C5K4J6AUW`, `A0C5QNZTWLC` in `openbot-dev` (`T0C5443H7CP`). Not used, not deleted. |
| Code | Branch `slack-messaging`, not merged |
| Worker secrets, Signal secret | Not set |
| Signal with the Slack route | Not deployed |

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
