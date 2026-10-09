# OpenBot Telegram bot

The one OpenBot Telegram bot, `@meetOpenBot` (bot ID `8630107594`). The OpenBot app links a chat
with a one-use `t.me` link, and the chat is linked to the OpenBot server that made the link. People
mention the bot in a group, reply to it, or send it a direct message, and the Telegram Orchestrator
agent on that OpenBot server asks the right agent and answers. No code runs here: this file lists the
settings of the bot in @BotFather.

Only Signal (`remote/api`) has the bot token. Telegram posts each update to Signal, and Signal makes
each Bot API call for the hosts. The account Worker (`apps/auth-api`) has only the bot ID and the
username. Hosts have no Telegram secret.

## BotFather settings

Make the bot with `/newbot` in [@BotFather](https://t.me/BotFather), and copy the token once.

- **Privacy mode**: keep it on (the default). Telegram then sends the bot only messages that mention
  it, replies to it and commands.
- **Allow groups**: keep it on (the default).
- **Commands**: set none. `/start` is only the link from the OpenBot app, and `stop` is a word or a
  button, not a command.
- **Profile photo** (`/setuserpic`): a square image of 512×512 or more, with a solid background.
  Telegram stores it as JPEG, so a transparent background becomes black. Telegram shows it in a
  circle: keep the logo in the center.
- **Name** (`/setname`):

  ```
  OpenBot
  ```

- **About** (`/setabouttext`, at most 120 characters):

  ```
  Your OpenBot AI teammates in Telegram. Mention @meetOpenBot in a group or send a direct message to delegate work.
  ```

- **Description** (`/setdescription`, at most 512 characters). Telegram shows it in an empty chat:

  ```
  OpenBot brings your AI teammates into Telegram.

  Mention @meetOpenBot in a group, reply to it, or send it a direct message to delegate work, follow progress, and get results without leaving the chat.

  Your AI teammates run in your own OpenBot workspace, with distinct roles, instructions, and context. Use them for research, writing, planning, summaries, and daily work. When an action needs approval, OpenBot asks first.

  To start, connect Telegram in the OpenBot app: Server settings → Connectors → Telegram.
  ```

Do not set a webhook by hand. Signal sets it when it starts.

## Secrets

| Where | Name | Value |
| --- | --- | --- |
| Worker | `TELEGRAM_BOT_ID` | The part of the token before `:`. Never the token. |
| Worker | `TELEGRAM_BOT_USERNAME` | The username, without `@`. |
| Worker | `SLACK_ROUTE_PRIVATE_JWK`, `SLACK_ROUTE_KEY_ID` | The Slack route key. It signs the Telegram route tickets too. |
| Signal | `TELEGRAM_BOT_TOKENS` | The bot token, `<bot ID>:<secret>`. Comma-separated for more than one bot. |
| Signal | `TELEGRAM_WEBHOOK_SECRET` | A random value of at least 32 bytes. Signal derives the webhook secret of each bot from it. |
| Signal | `TELEGRAM_WEBHOOK_ORIGIN` | `https://signal.openbot.run`. Signal sets each bot's webhook to `<origin>/v1/telegram/updates/<bot ID>`. |

The Worker values are in the encrypted `apps/auth-api/.env.production` and `.env.dev`, and the Signal
values in the encrypted `remote/.env.production`. `scripts/deploy-auth-api.ts` (`bun run api:deploy`)
sets the Worker values. Without them, the Telegram routes answer 503 `telegram_not_configured`.

Production and development use the same bot now. A bot has one webhook, so a local test (see
[docs/messaging.md](../../docs/messaging.md#test-telegram-locally)) moves the webhook from
production. A production Signal sets it back when it starts.

To check the webhook:

```sh
curl -s "https://api.telegram.org/bot<token>/getWebhookInfo"
```

## Limits of Telegram

- With privacy mode on, a message that does not mention the bot and does not reply to it does not
  reach OpenBot.
- A basic group has no reply threads. OpenBot keeps the reply chain in memory, so after a restart an
  older chain needs a mention or a reply to the bot.
- A group has no private message. When a person who is not the requester presses an approval button,
  the bot answers in the chat.
- A bot can send and receive files of at most 20 MB.
- Telegram does not send an update again. An update that comes while the host is offline is lost.
