# `remote/api`

The Remote API is the Signal service. It verifies remote tickets, issues resume tokens and TURN
credentials, and relays WebRTC signalling between peers. It does not carry team chats, files, or
commands. The one exception is `POST /v1/slack/events`: it checks the OpenBot Slack app's signature,
reads only the workspace ID (`team_id`) and the `url_verification` challenge, and passes the body to
the `ingress` socket of the workspace's host in transit. Do not store or log that body, and do not
read more of it. Hosts trust a delivery because Signal checked the signature; never remove that
check.

- The message shapes come from `@openbot/contracts/signal-protocol`. `src/protocol.ts` only
  re-exports them for the server. Change them there, and keep released messages compatible.
- `src/tokens.ts` holds the secrets. Compare secrets in constant time (`timingSafeEqual`), and keep
  the TTL limits. Never log a ticket, a token, a Slack route ticket or request body, a TURN credential, or a secret from
  `src/config.ts`. Log only the error
  message, as `src/app.ts` does.
- This project uses Bun types. Keep them inside `remote/api`; root `scripts/**` and Electron main
  use Node types. See [check design notes](../../docs/development-checks.md#check-coverage).
- `remote/scripts/update.ts` recreates the live coturn container. Do not run it as a check.

Run one test file: `bun run --cwd remote/api test -- test/<name>.test.ts`.
