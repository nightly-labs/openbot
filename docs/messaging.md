# Messaging connections

The agents of this computer can answer in an external chat platform. Slack is supported today. The
design notes are in [ARCHITECTURE.md](ARCHITECTURE.md#messaging-connections), and the launch steps
in [apps/slack-app/LAUNCH.md](../apps/slack-app/LAUNCH.md).

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
3. In `apps/auth-api/.env.dev`, add `SLACK_ROUTE_PRIVATE_JWK` with the same value as
   `REMOTE_TICKET_PRIVATE_JWK`, and `SLACK_ROUTE_KEY_ID=openbot-remote-1`. Development only: the
   ticket key's public key is already in the JWKS that Signal loads.
4. Run `bun run dev:slack` (add `--isolated` for a profile of this worktree). Set the printed address
   as the development app's request URL, for events and interactivity. It changes on each start.

The install itself needs an account API that Slack can send the browser back to over HTTPS. Use the
test Worker (`bun run deploy:test`) with the development app's `SLACK_CLIENT_ID` and
`SLACK_CLIENT_SECRET`. Not confirmed: a local install that returns to a dev app on a computer that
also has an installed OpenBot. The operating system sends `openbot://` to the installed app.

## Troubleshooting

| State | Cause | Action |
| --- | --- | --- |
| Token not accepted | Slack refused the token, or OpenBot was uninstalled from the workspace. | **Connect Slack** again. |
| Missing permissions | The install has fewer scopes than OpenBot asks for. | **Disconnect**, then **Connect Slack** again. |
| Waiting for Slack | Slack rate-limited OpenBot. | Nothing. The host tries again at the time shown. |
| Tokens unreadable | The host cannot decrypt the stored token. | **Disconnect**, then **Connect Slack** again. |
| Reconnecting | The host lost the connection. | Nothing, or **Reconnect** after the network is back. |
| Cannot receive events | This computer cannot reach Signal: it is signed out, has no name, or Signal is down. | Sign in, name this computer in **Server settings**, keep OpenBot open. |
| "Another OpenBot server already answers this Slack workspace" | Another account connected the workspace. | Disconnect it on that server, then try again. |

## Limits

- The host must run. Slack sends an event again after about 1 and 5 minutes when this computer does
  not answer, then drops it.
- An agent runs one turn at a time. A Slack request waits behind the agent's own work and behind
  channel work, and the thread shows that it waits. One agent keeps at most 5 Slack requests waiting,
  and one person at most 2.
- Slack sends every message of every channel that OpenBot is in to this computer, through Signal.
  Since OpenBot is in every public channel, a busy workspace sends many events. The host keeps only
  the messages that address OpenBot or continue a conversation it has.
- Until the Slack Marketplace approves OpenBot, Slack limits reading a thread to 1 request per minute
  and 15 messages, so an agent can see less context.
- Anyone who can post in the workspace, guests and Slack Connect members included, can give the
  agents work. They run with the access you gave them. With Turbo or **Always allow**, they run
  commands without asking.
- A hosted server stays awake while a Slack connection is live.
- When an agent asks another OpenBot agent for something in a Slack conversation, the reply comes
  back to that conversation. The agent then posts its answer in the same thread, and the original
  message keeps its reactions.
- A question the agent asks is answered on the host. Slack shows nothing for it.

## Adding a platform

A platform is one `MessagingDriver` (`src/backend/messaging/messaging-types.ts`) and nothing in the
core changes:

- `createAdapter` implements `MessagingAdapter`: post, edit, react, upload, download, history,
  author and place names, and mentions.
- `createTransport` implements `MessagingTransport` and turns the platform's events into
  `InboundMessage` and `InboundAction` values. It must not need a public address on the host.

| Platform | Transport | Conversation key | Notes |
| --- | --- | --- | --- |
| Slack | The Events API through Signal | `thread_ts`, or the message `ts` that starts a thread | Implemented. |
| Discord | Gateway WebSocket (`@discordjs/ws` style: heartbeat, resume) | The thread channel id, or the message id that starts a thread | Needs the Message Content intent. Reactions map directly. |
| Telegram | Long polling with `getUpdates` and an offset | `message_thread_id` in a forum, else the chat id | No history API: store what the bot sees for context. |

Then add the platform to `MESSAGING_PLATFORMS`, a page in Server settings → Connectors, and its i18n
keys. The database needs no migration: `platform` has no `CHECK`.
