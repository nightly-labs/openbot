# `remote/api`

The Remote API is the Signal service. It verifies remote tickets, issues resume tokens and TURN
credentials, and relays WebRTC signalling between peers. It does not carry team chats, files, or
commands. The exceptions are Slack, Discord and Telegram. `POST /v1/slack/events` checks the OpenBot Slack
app's signature, reads only the app ID (`api_app_id`), the workspace ID (`team_id`), the
`url_verification` challenge, and the event's `type`, `channel_type`, `thread_ts`, `bot_id` and
`subtype` (to know whether it addresses OpenBot, never the text), and passes the body to the `ingress`
socket of the workspace's host in transit. `POST /v1/telegram/updates/<bot ID>` checks the bot's secret header, reads only the chat ID,
the callback query ID and a `/start <code>` link code, and passes the body to the `ingress` socket of
the chat's host in the same way. Do not log these bodies, and do not read more of them. The one store
is `src/ingress-queue.ts`: for a hosted server that sleeps, it keeps an event in memory only, sealed to
the host's queue key before it is queued, for at most 10 minutes. Never keep a body that is not
sealed, and never write the queue to disk. Hosts
trust a delivery because Signal checked the signature or the secret; never remove those checks.

Signal holds the Telegram bot tokens: a host that had one could read and post in every chat. Never
put a bot token in a frame, a log, an error message or a result. A host calls the Bot API only
through `telegram-call`, and `src/protocol.ts` accepts only the methods and the parameters of
`TelegramCallParams`, with strict objects. Do not add a method or a key there without the same
change in the contract. `src/signal-service.ts` allows a call only into a chat routed to that socket,
and an answer only to a callback query delivered to it. A result has only the reduced fields of
`TelegramCallResult`. Files go through short signed tokens (`TelegramFileTokens`); an upload token
works once.

Signal also holds the OpenBot Discord bot. `src/discord-gateway.ts` holds the bot token and the
Gateway connection; `src/discord-events.ts` turns a Gateway event into a delivery for the `ingress`
socket of the guild's host; `src/discord-api.ts` makes the typed Discord calls of `POST
/v1/discord/api` for a host, only in the guilds routed to its socket. Never log the bot token, a
`discord-session` token, an interaction token, a message's content or Discord's error text. Never
let a host call Discord in a guild or channel that is not routed to its socket.

- The message shapes come from `@openbot/contracts/signal-protocol`. `src/protocol.ts` only
  re-exports them for the server. Change them there, and keep released messages compatible.
- `src/tokens.ts` holds the secrets. Compare secrets in constant time (`timingSafeEqual`), and keep
  the TTL limits. Never log a ticket, a token, a Slack, Discord or Telegram route ticket, a request
  or update body, a bot token, a file or upload token, a TURN credential, or a secret from
  `src/config.ts`. Log only the error
  message, as `src/app.ts` does.
- This project uses Bun types. Keep them inside `remote/api`; root `scripts/**` and Electron main
  use Node types. See [check design notes](../../docs/development-checks.md#check-coverage).
- `remote/scripts/update.ts` recreates the live coturn container. Do not run it as a check.

Run one test file: `bun run --cwd remote/api test -- test/<name>.test.ts`.
