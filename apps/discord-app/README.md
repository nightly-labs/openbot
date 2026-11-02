# OpenBot Discord app

The one OpenBot Discord app. A Discord server installs it through `POST /v2/discord/authorize`, and
the server (a guild) is linked to the OpenBot server that connected it. People mention @OpenBot in a
channel, and the Discord Orchestrator agent on that OpenBot server asks the right agent and answers.
No code runs here: this file lists the settings of the app in the Discord Developer Portal.

Only Signal (`remote/api`) has the bot token. Signal keeps the bot's Gateway connection and makes
each Discord call for the hosts. The account Worker (`apps/auth-api`) has the client secret for the
install. Hosts have no Discord secret.

## Developer Portal settings

Make one application for production and one for development at
<https://discord.com/developers/applications>.

- **General Information**: set the name `OpenBot` (or `OpenBot (dev)`), the icon and the
  description. Do not set an **Interactions Endpoint URL**: Signal receives button presses through
  the Gateway.
- **Installation**: select **Guild Install** only. Set **Install Link** to **None**: servers install
  the app through OpenBot.
- **OAuth2 → Redirects**: add `https://api.openbot.run/v2/discord/callback`, or the test Worker's
  `/v2/discord/callback` for the development app.
- **Bot**:
  - Turn off **Public Bot** until the launch. When it is off, only the owner of the application can
    add the bot to a server.
  - Turn off **Requires OAuth2 Code Grant**.
  - Turn on **Message Content Intent**, and leave the other privileged intents off. With it,
    OpenBot reads the message that a person replies to and the earlier messages of a conversation.
    Signal asks for it by default. A bot that is verified, or in 100 or more servers, needs
    Discord's approval for the intent first.
  - Select **Reset Token** and copy the bot token once.

The install asks for the permissions in `DISCORD_BOT_PERMISSIONS`
(`packages/contracts/src/discord-app.ts`): view channels, send messages, send messages in threads,
embed links, attach files, read message history and add reactions. Signal asks for the intents in
`DISCORD_GATEWAY_INTENTS`: guilds, guild messages and direct messages, and adds
`DISCORD_MESSAGE_CONTENT_INTENT` unless `DISCORD_MESSAGE_CONTENT` is `false`.

## Secrets

| Where | Name | Value |
| --- | --- | --- |
| Worker | `DISCORD_CLIENT_ID` | The application ID. |
| Worker | `DISCORD_CLIENT_SECRET` | **OAuth2 → Client Secret**. |
| Worker | `DISCORD_STATE_SECRET` | A random value of at least 32 bytes. It signs the install `state`. |
| Worker | `DISCORD_ROUTE_PRIVATE_JWK`, `DISCORD_ROUTE_KEY_ID` | An ES256 key that signs route tickets. Put its public key in `REMOTE_TICKET_PUBLIC_JWKS`. |
| Signal | `DISCORD_BOT_TOKEN` | The bot token. |
| Signal | `DISCORD_APPLICATION_ID` | The application ID. |
| Signal | `DISCORD_MESSAGE_CONTENT` | Optional. `false` stops Signal asking for the Message Content intent. Not a secret. |

`scripts/deploy-auth-api.ts` (`bun run --cwd apps/auth-api deploy`) sets the Worker secrets when they are in the environment. Without them, the
Discord routes answer 503 `discord_not_configured`. Without the Signal values, Signal keeps no Gateway
connection and Discord calls answer 503 `unavailable`; Slack and remote access continue to work.

One Signal holds one bot token, so one Signal serves one Discord application. Use a separate Signal
for the development application.

## Limits of Discord

- Discord has no thread of replies. A conversation is a chain of replies, and OpenBot replies to the
  first message of it, so that each reply to an OpenBot post names the conversation.
- Only a message that mentions OpenBot reaches it. A reply keeps the mention when its **@ ON**
  setting stays on (the default).
- Without the Message Content intent, Discord gives OpenBot the text only of a message that
  mentions it, so OpenBot does not see the message that a person replies to or the other messages
  of the channel. When Discord refuses the intent, Signal logs one line and connects without it.
- When a server has a list of roles, OpenBot ignores a mention from a member who has none of them.
- A direct message to OpenBot gets one fixed answer: a direct message has no server, so Signal cannot
  find the OpenBot server that answers it.
- Discord limits a bot's file to 10 MB unless the server has a higher boost level. OpenBot sends at
  most 10 MB for each file.
- Discord asks for verification before a bot can be in more than 100 servers.
