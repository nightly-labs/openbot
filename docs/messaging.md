# Messaging connections

An agent can answer in an external chat platform. Slack is supported today. The design notes are in
[ARCHITECTURE.md](ARCHITECTURE.md#messaging-connections).

## Connect an agent to Slack

OpenBot creates a Slack app for each agent, so each agent is its own bot user: people can mention it
and send it direct messages, and each agent in a workspace is a separate app. This needs an OpenBot
account and a name for this computer (**Server settings**), because Slack sends the app's events to
OpenBot's Signal service, which passes them to this computer.

1. Open **Server settings → Connectors → Slack**.
2. Select **Connect Slack**. Slack opens in the browser. Select the workspace, and allow the OpenBot
   manager app to create and change apps there. You do this one time: every agent goes to this
   workspace.
3. Select **Add agent**, or **Add to Slack** on the agent's row. Pick the agent, check the preview,
   then select **Create in Slack**. OpenBot creates a Slack app with the agent's name and opens its
   install page. Select **Allow**. If the workspace needs an admin to approve new apps, the agent
   shows **Waiting for install** until the admin approves; then select **Continue** on its row.
4. In Slack, mention the agent in any public channel, or send it a direct message.

The agent joins every public channel of the workspace, and each public channel that is created
later. Slack shows "joined #channel" in each one. A private channel needs an invitation:
`/invite @name`. The app's icon is the agent's avatar; OpenBot sets it when the Slack page first shows the
agent after OpenBot starts.

When the agent is renamed, OpenBot renames its Slack app. **Remove** on the agent's row, or
deleting the agent, deletes the app. **Disconnect** in the Workspace section removes the manager
token from this computer and revokes it; the apps that exist keep working. Then **Connect Slack**
can connect another workspace.

Only the computer that runs the agent can add it to Slack, because Slack returns to that computer's
browser. A joined server shows no Slack page.

## What the agent does in Slack

- A mention in a channel starts, or continues, a conversation in that thread. A reply in that thread
  reaches the agent without a mention.
- A direct message to the app always reaches the agent. All direct messages from one person are one
  conversation.
- Each conversation is its own OpenBot thread of the agent, so it does not mix with the agent's own
  chat.
- The agent sees up to 30 earlier messages of the thread as context, and the files of the message.
- 👀 means the message arrived. "Working on it…" is replaced by the answer. ✅, ❌ or ⏹ shows the end.
- An approval appears in the thread with **Approve** and **Deny**. Only the person who wrote the
  message can answer it there. The OpenBot host can always answer it.
- `stop` or `cancel` in the thread, or the **Stop** button, stops the request of the person who
  sends it.

## Test Slack locally

Slack must reach Signal and the dev app over public HTTPS, and until Slack enrolls the OpenBot
manager app, its OAuth cannot give a workspace token. `bun run dev:slack` covers both. It opens a
`cloudflared` tunnel to Signal and one to a sign-in listener in the dev app, so the install returns
to the dev app even when an installed OpenBot owns the `openbot://` links.

1. Install `cloudflared` (`brew install cloudflared`).
2. At <https://api.slack.com/apps>, under **Your App Configuration Tokens**, generate a token for the
   test workspace. Copy the **Access Token** (`xoxe.xoxp-…`). It lasts 12 hours.
3. Write `.env.slack-dev` in the worktree root. Git ignores it.
   ```
   OPENBOT_DEV_SLACK_CONFIG_TOKEN='xoxe.xoxp-…'
   OPENBOT_DEV_SLACK_WORKSPACE_ID='T…'
   OPENBOT_DEV_SLACK_WORKSPACE_NAME='…'
   ```
4. In `apps/auth-api/.env.dev`, add `SLACK_ROUTE_PRIVATE_JWK` with the same value as
   `REMOTE_TICKET_PRIVATE_JWK`, and `SLACK_ROUTE_KEY_ID=openbot-remote-1`. Development only: the
   ticket key's public key is already in the JWKS that Signal loads.
5. Run `bun run dev:slack` (add `--isolated` for a profile of this worktree).
6. Sign in, give this computer a name in **Server settings**, then **Server settings → Connectors →
   Slack → Add agent**, and **Allow** on the Slack page.

The token stands in for the workspace's manager token, so the workspace shows as connected and
**Connect Slack** is not used. **Disconnect** in the Workspace section forgets the token until the
next start and does not revoke it.
The tunnel addresses change on each start. At start, OpenBot moves each app it made to the new
address, while the token lasts. A packaged build ignores all of these variables.

## Troubleshooting

| State | Cause | Action |
| --- | --- | --- |
| Token not accepted | Slack refused the app's token, or the app was uninstalled. | **Remove**, then **Add to Slack** again. |
| Missing permissions | The app has fewer scopes than OpenBot asks for. | **Remove**, then **Add to Slack** again. |
| Waiting for Slack | Slack rate-limited the app. | Nothing. The host tries again at the time shown. |
| Tokens unreadable | The host cannot decrypt the stored tokens. | **Remove**, then **Add to Slack** again. |
| Reconnecting | The host lost the connection. | Nothing, or **Reconnect** after the network is back. |
| Waiting for install | The agent's Slack app exists, but it is not installed in the workspace. | **Continue**, or ask a workspace admin to approve the app. |
| Cannot receive events | The app gets its events through Signal, and this computer cannot reach it: it is signed out, has no name, or Signal is down. | Sign in, name this computer in **Server settings**, keep OpenBot open. |
| "Slack did not delete its app" after **Remove** | The agent is removed, but Slack refused to delete the app, or the workspace token is gone. | Delete the app at api.slack.com/apps. |

## Limits

- The host must run. Messages sent while it is offline, asleep or stopped are not answered later.
- An agent runs one turn at a time. A Slack request waits behind the agent's own work and behind
  channel work, and the thread shows that it waits. One agent keeps at most 5 Slack requests waiting,
  and one person at most 2.
- A free Slack workspace allows at most 10 apps, and each agent uses one.
- Slack sends every message of every channel the agent is in to this computer, through Signal. Since
  the agent is in every public channel, a busy workspace sends many events. The host keeps only the
  messages that address the agent. Slack does not document a
  limit for paid plans. A workspace can also require an admin to approve each new app.
- Slack sends the events through Signal. When this computer does not answer, Slack sends an event
  again after about 1 and 5 minutes, then drops it.
- Anyone who can post in the workspace, guests and Slack Connect members included, can give the
  agent work. The agent runs with the access you gave it. With Turbo or **Always allow**, it runs
  commands without asking.
- A hosted server stays awake while a Slack connection is live.
- When the agent asks another OpenBot agent for something in a Slack conversation, the reply comes
  back to that conversation. The agent then posts its answer in the same thread, and the original
  message keeps its reactions.
- A question the agent asks is answered on the host, not in Slack.

## Adding a platform

A platform is one `MessagingDriver` (`src/backend/messaging/messaging-types.ts`) and nothing in the
core changes:

- `validateCredentials` checks the form of what the user pastes.
- `createAdapter` implements `MessagingAdapter`: post, edit, react, upload, download, history,
  author and place names, and mentions.
- `createTransport` implements `MessagingTransport` and turns the platform's events into
  `InboundMessage` and `InboundAction` values. It must not need a public address on the host.

| Platform | Transport | Conversation key | Notes |
| --- | --- | --- | --- |
| Slack | The Events API through Signal | `thread_ts`, or `direct` for a DM | Implemented. |
| Discord | Gateway WebSocket (`@discordjs/ws` style: heartbeat, resume) | The thread channel id, or the message id that starts a thread | Needs the Message Content intent. Reactions map directly. |
| Telegram | Long polling with `getUpdates` and an offset | `message_thread_id` in a forum, else the chat id | No history API: store what the bot sees for context. |

Then add the platform to `MESSAGING_PLATFORMS` and to the `messaging-v1` codec (a new capability,
because the codec is frozen), a page in Server settings → Connectors, and its i18n keys. The database needs no
migration: `platform` has no `CHECK`.
