# Messaging connections

The agents of this computer can answer in an external chat platform. Slack, Discord and Telegram
are supported today. The design notes are in
[architecture/channels-and-messaging.md](architecture/channels-and-messaging.md#messaging-connections),
the Slack launch steps in [apps/slack-app/LAUNCH.md](../apps/slack-app/LAUNCH.md), and the Discord app
settings in [apps/discord-app/README.md](../apps/discord-app/README.md).

## Connect Slack

A workspace installs the one OpenBot Slack app. People mention @OpenBot or send it a direct message,
and the Slack Orchestrator, an agent that OpenBot adds, asks the right agent and answers. This needs an OpenBot account and a name for this
computer (**Server settings**), because Slack sends the workspace's events to OpenBot's Signal
service, which passes them to this computer.

1. Open **Server settings → Connectors → Slack**.
2. Select **Connect Slack**, then **Connect in Slack**. Slack opens in the browser. Select the
   workspace in the top-right corner, and select **Allow**. The dialog continues by itself.
3. Pick the model of the Slack Orchestrator, and select **Add agent**. OpenBot adds the agent, with its
   instructions and the facts it starts with, in a sidebar section named **Integrations**, which starts
   collapsed. You can rename it or change its model in agent settings.
4. In Slack, mention @OpenBot in any public channel, or send it a direct message.

OpenBot joins every public channel of the workspace when it connects, and each public channel that is
created later. Slack shows "joined #channel" in each one. A private channel needs an invitation:
`/invite @OpenBot`.

A workspace answers to one OpenBot server. Another account cannot connect a workspace that your
server answers until you disconnect it. **Disconnect** revokes the token, removes it from this
computer and unlinks the workspace; the conversations stay in OpenBot, and a later **Connect Slack**
gives them back their agents.

Only the computer that runs the agents can connect Slack, because Slack returns to that computer's
browser. A joined server shows no Slack page.

## What happens in Slack

- A mention in a channel starts, or continues, a conversation in that thread. A reply in that thread
  reaches the same agent without a mention.
- A direct message always reaches OpenBot. OpenBot answers in a thread under it, so each direct
  message is its own conversation.
- A new conversation goes to the Slack Orchestrator. It answers short requests itself, and gives other
  work to the one agent that fits best. That agent's answer comes back to the thread, and the
  orchestrator posts it. Until you add the orchestrator, Slack gets "No agent can answer here yet".
- Each conversation is its own OpenBot thread of that agent, so it does not mix with the agent's own
  chat.
- The agent sees earlier messages of the thread as context, and the files of the message.
- 👀 means the message arrived. "Working on it…" is replaced by the answer. ✅, ❌ or ⏹ shows the end.
  Every post comes from OpenBot and names no agent.
- An approval appears in the thread with **Approve** and **Deny**. Only the person who wrote the
  message can answer it there. The OpenBot host can always answer it.
- `stop` or `cancel` in the thread, or the **Stop** button, stops the request of the person who
  sends it.

## Connect Discord

A Discord server installs the one OpenBot Discord app. People mention @OpenBot in a channel, and the
Discord Orchestrator, an agent that OpenBot adds, asks the right agent and answers. As for Slack, this
needs an OpenBot account and a name for this computer (**Server settings**): Signal keeps the bot's
Discord connection, passes the server's mentions to this computer, and makes OpenBot's Discord posts
for it.

1. Open **Server settings → Connectors → Discord**.
2. Select **Connect Discord**, then **Connect in Discord**. Discord opens in the browser. Select the
   Discord server, and select **Authorize**. You must have the **Manage Server** permission there. The
   dialog continues by itself.
3. Pick the model of the Discord Orchestrator, and select **Add agent**. It goes to the
   **Integrations** sidebar section, as the Slack Orchestrator does.
4. In Discord, mention @OpenBot in a channel.

OpenBot sees each channel that its role can view. To keep OpenBot out of a channel, remove the view
permission of its role there.

A Discord server answers to one OpenBot server. Another account cannot connect a Discord server that
your server answers until you disconnect it. **Disconnect** unlinks the Discord server and removes it
from this computer; the conversations stay in OpenBot. OpenBot stays a member of the Discord server
until a Discord admin removes it. When a Discord admin removes OpenBot, Signal unlinks the server, also
when this computer is off, and the row says that the token is not accepted (for a computer that was
off, when it connects again). **Reconnect** then starts
the install again. A **Disconnect** that cannot reach the account service changes nothing; try it
again.

## What happens in Discord

- A message that mentions @OpenBot starts a conversation. OpenBot replies to that message.
- A reply to an OpenBot post continues the same conversation. The reply must keep the mention:
  Discord's **@ ON** setting of a reply does this, and it is on by default. Without the mention,
  Discord does not give the text to OpenBot.
- A mention that replies to another person's message starts a new conversation.
- A direct message to OpenBot gets one fixed answer: mention OpenBot in a server channel.
- The rest works as in Slack: the Discord Orchestrator receives each new conversation, 👀 shows that
  the message arrived, "Working on it…" is replaced by the answer, and ✅, ❌ or ⏹️ shows the end.
  An approval has **Approve** and **Deny** buttons, and a status post has **Stop**. Only the person
  who wrote the request can press them; another person gets a reply that only they see. A reply to
  an OpenBot post with only `stop` or `cancel` stops the request of the person who sends it.
- A post never pings anyone, also when it names a person.
- An answer longer than 2,000 characters is sent in more than one post. A file larger than 10 MB is
  not sent, and the conversation says which files were not sent.

## Connect Telegram

One OpenBot bot serves every user. People mention it in a group, or reply to its messages, and the
Telegram Orchestrator, an agent that OpenBot adds, asks the right agent and answers. This needs an
OpenBot account and a name for this computer (**Server settings**), because Telegram sends the
updates to OpenBot's Signal service, which passes them to this computer. Signal holds the bot token;
this computer never has it.

1. Open **Server settings → Connectors → Telegram**.
2. Select **Add to a group** or **Open a direct chat**. Telegram opens with a one-use link (it is
   valid for 15 minutes). Pick the group, or select **Start**. The chat appears in OpenBot by itself.
3. Pick the model of the Telegram Orchestrator, and select **Add agent**. One orchestrator answers
   every Telegram chat. It goes in the **Integrations** section of the sidebar.
4. In the group, mention the bot (`@<bot> …`), or reply to one of its messages.

A chat answers to one OpenBot server. Another account cannot link a chat that your server answers
until you disconnect it. **Disconnect** makes the bot leave the chat and unlinks it; the
conversations stay in OpenBot, and a later link of the same chat gives them back their agents.

## What happens in Telegram

- A mention starts, or continues, the conversation of its reply chain. In a supergroup, Telegram
  gives each reply chain its own thread, so a reply to the bot, or to a message in the chain, reaches
  the same agent without a mention. In a forum, each topic is one conversation. A direct chat is one
  conversation.
- With privacy mode on (Telegram's default), Telegram sends the bot only messages that mention it,
  replies to it and commands. Other messages of the chat do not reach this computer.
- 👀 means the message arrived. "Working on it…" is replaced by the answer. 👌, 💔 or 🫡 shows the end.
- An approval appears with **Approve** and **Deny**. Only the person who wrote the message can answer
  it there. When another person presses a button, the bot answers in the chat that only the requester
  can do it.
- `@<bot> stop` or a reply `stop` to the bot, or the **Stop** button, stops the request.
- Files up to 20 MB go both ways.

## Test Telegram locally

Telegram must reach Signal over public HTTPS.

1. Make a development bot with [@BotFather](https://t.me/BotFather). Keep privacy mode on.
2. Start a tunnel to the local Signal, for example `cloudflared tunnel --url http://127.0.0.1:<signal port>`.
3. Give Signal `TELEGRAM_BOT_TOKENS` (the bot token), `TELEGRAM_WEBHOOK_SECRET` (32 bytes or more) and
   `TELEGRAM_WEBHOOK_ORIGIN` (the tunnel address). Signal sets the bot's webhook when it starts.
4. In `apps/auth-api/.env.dev`, set `TELEGRAM_BOT_ID` (the part of the token before `:`),
   `TELEGRAM_BOT_USERNAME`, and the Slack route key (see below): it signs the Telegram route ticket too.

Not confirmed: this flow end to end against Telegram. The tests use a fake Signal and a fake Bot API.

## Test Slack locally

Slack must reach Signal over public HTTPS. `bun run dev:slack` opens a `cloudflared` tunnel to the
local Signal and gives it the development app's signing secret.

1. Install `cloudflared` (`brew install cloudflared`).
2. Write `.env.slack-dev` in the worktree root. Git ignores it.
   ```
   OPENBOT_DEV_SLACK_SIGNING_SECRET='…'
   ```
   The value is the signing secret of `OpenBot (dev)` (`A0C5G5XGS83`), under **Basic Information**
   at <https://api.slack.com/apps>.
3. Export `SLACK_ROUTE_PRIVATE_JWK` in the shell with the same value as
   `REMOTE_TICKET_PRIVATE_JWK` in `.openbot/dev-state.json`, and export
   `SLACK_ROUTE_KEY_ID=openbot-remote-1`. Development only: the
   ticket key's public key is already in the JWKS that Signal loads.
4. Run `bun run dev:slack` (add `--shared` for the shared `OpenBot Dev` profile). Set the printed address
   as the development app's request URL, for events and interactivity. It changes on each start.

The install itself needs an account API that Slack can send the browser back to over HTTPS. Use the
test Worker (`bun run deploy:test`) with the development app's `SLACK_CLIENT_ID` and
`SLACK_CLIENT_SECRET`. Not confirmed: a local install that returns to a dev app on a computer that
also has an installed OpenBot. The operating system sends `openbot://` to the installed app.

## Troubleshooting

The workspace row says what is wrong.

| Problem | Cause | Action |
| --- | --- | --- |
| Token not accepted | Slack refused the token, or OpenBot was uninstalled from the workspace. | **Connect Slack** again. |
| Missing permissions | The install has fewer scopes than OpenBot asks for. | **Disconnect**, then **Connect Slack** again. |
| Waiting for Slack | Slack rate-limited OpenBot. | Nothing. The host tries again at the time shown. |
| Tokens unreadable | The host cannot decrypt the stored token. | **Disconnect**, then **Connect Slack** again. |
| Reconnecting | The host lost the connection. | Nothing, or **Reconnect** after the network is back. |
| Cannot receive events | This computer cannot reach Signal: it is signed out, has no name, or Signal is down. | Sign in, name this computer in **Server settings**, keep OpenBot open. |
| "Another OpenBot server already answers this Slack workspace" | Another account connected the workspace. | Disconnect it on that server, then try again. |

## Limits

These limits are for Slack. Discord's are in [apps/discord-app/README.md](../apps/discord-app/README.md#limits-of-discord),
and these also apply to Discord: the host must run, the queue limits, who can give work, and that a
hosted server that sleeps starts for a message. Discord sends an event once: an event that arrives
while this computer has no Signal connection is lost, except for a hosted server that starts.

- The host must run. Slack sends an event again after about 1 and 5 minutes when this computer does
  not answer, then drops it.
- An agent runs one turn at a time. A Slack request waits behind the agent's own work and behind
  channel work, and the thread shows that it waits. One agent keeps at most 20 Slack requests waiting,
  and one person at most 2.
- Slack sends every message of every channel that OpenBot is in to this computer, through Signal.
  Since OpenBot is in every public channel, a busy workspace sends many events. The host keeps only
  the messages that address OpenBot or continue a conversation it has.
- Until the Slack Marketplace approves OpenBot, Slack limits reading a thread to 1 request per minute
  and 15 messages, so an agent can see less context.
- Anyone who can post in the workspace, guests and Slack Connect members included, can give the
  agents work. They run with the access you gave them. With Turbo or **Always allow**, they run
  commands without asking.
- A hosted server sleeps after 15 minutes with no use, also with a live connection. A mention, a
  direct message, a thread reply or a button press starts it. Signal keeps that message, encrypted,
  for up to 10 minutes and gives it to the server when it connects, so the answer comes after the
  server starts (a few minutes). A restart of Signal in that time loses it.
- When an agent asks another OpenBot agent for something in a Slack conversation, the reply comes
  back to that conversation. The agent then posts its answer in the same thread, and the original
  message keeps its reactions.
- A question the agent asks is answered on the host. Slack shows nothing for it.
- Telegram does not send an update again. An update that arrives while this computer is off, or
  while it cannot reach Signal, is lost. A hosted server that sleeps starts for a message or a button
  press, and gets it when it connects.
- In a basic Telegram group (not a supergroup), OpenBot finds the reply chain in memory. After a
  restart, a reply to an older message starts a new conversation.
- When a Telegram group becomes a supergroup, it gets a new ID. OpenBot shows the chat as removed:
  disconnect it, and add the bot again.
- Telegram has no history API. The agent sees as context only the messages that this computer saw
  since it started, and the message that a request answers.

## Adding a platform

A platform is one `MessagingDriver` (`src/backend/messaging/messaging-types.ts`) and nothing in the
core changes:

- `createAdapter` implements `MessagingAdapter`: post, edit, react, upload, download, history,
  author and place names, and mentions.
- `createTransport` implements `MessagingTransport` and turns the platform's events into
  `InboundMessage` and `InboundAction` values. It must not need a public address on the host.
- `requiredCredential` names the stored value without which a connection does not start.

| Platform | Transport | Conversation key | Notes |
| --- | --- | --- | --- |
| Slack | The Events API through Signal | `thread_ts`, or the message `ts` that starts a thread | Implemented. |
| Discord | The Gateway in Signal (`@discordjs/ws`), which passes mentions to the host; calls go through Signal | The id of the first message of a reply chain | Implemented. No privileged intent. |
| Telegram | The webhook of the one OpenBot bot through Signal, which holds the token | `message_thread_id`, the topic in a forum, `dm` in a direct chat | Implemented. No history API: the host keeps what the bot sees, in memory. |

Then add the platform to `MESSAGING_PLATFORMS`, a page in Server settings → Connectors, and its i18n
keys. The database needs no migration: `platform` has no `CHECK`.
