# Slack in production

How agents in Slack look and work once these are in place:

- Slack has enrolled the OpenBot manager app.
- The Worker has its Slack secrets.
- Signal and its Nginx configuration are deployed.

The requirements for the manager app are in [slack-manager-app.md](slack-manager-app.md). The
design is in [ARCHITECTURE.md](ARCHITECTURE.md#messaging-connections), and the user guide is in
[messaging.md](messaging.md).

## One time, per computer

1. The user is signed in to OpenBot, and the computer has a name in **Server settings**. Most users
   already have both.
2. **Server settings → Connectors → Slack → Connect Slack.** The browser opens Slack's consent page for the
   **OpenBot** manager app. The user selects the workspace in the top-right corner and clicks
   **Allow**.
3. Slack returns to `openbot.run`. The page there opens the installed OpenBot app, and the screen
   shows the workspace in the Workspace section.

## For each agent

1. **Add agent**, then **Create in Slack.** OpenBot creates a Slack app named after the agent, with
   its description, and opens Slack's install page.
2. The user clicks **Allow**. The page opens OpenBot again, and the state becomes **Connected**. The
   icon becomes the agent's avatar within a few seconds.
3. If the workspace requires an admin to approve new apps, the state stays **Waiting for install**
   until an admin approves. Then the user clicks **Continue** on the agent's row.

## What people see in Slack

- Each agent is a separate app with its own name and avatar, listed under **Apps**.
- It joins every public channel. Each channel shows "Chief joined" one time. New public channels are
  joined when they are created.
- People @mention it in any public channel, or send it a direct message. For a private channel,
  someone must `/invite` it.
- The reply comes in the thread: 👀 → "Working on it…" with a Stop button → the answer, then ✅.
  Approvals show **Approve** and **Deny** buttons, which only the person who asked can press.

## Behind the scenes

- Slack sends events to `signal.openbot.run`. Signal passes each one to the host over the host's own
  connection and stores nothing. Answers go from the host straight to Slack.
- The app's URL does not change, so after a restart events arrive again with nothing to reinstall.
  Events sent while the app is closed are retried for about 6 minutes, then lost.
- Renaming the agent renames the app. A new avatar reaches Slack the next time the Slack page
  shows after OpenBot starts. **Remove**, or deleting the agent, deletes the app.

## How it differs from a local test

| | Local (`bun run dev:slack`) | Production |
| --- | --- | --- |
| Workspace token | A Slack configuration token in `.env.slack-dev`, 12 hours | The manager app's OAuth through **Connect Slack** |
| Request URL | A `trycloudflare.com` tunnel to local Signal, new at each start | `signal.openbot.run`, fixed |
| Install return | A tunnel to a dev-only listener in the dev app | `openbot.run/slack/connect`, which opens `openbot://` |
| App icon | Probably not set: the manager app did not create the app | The agent's avatar |

## Limits users will meet

- A free Slack workspace allows at most 10 apps, so at most 10 agents. The settings screen says this.
- Only the host's own desktop can add an agent to Slack. On a joined server or the web client, an
  admin can pause, reconnect, disconnect and read the conversations, but cannot add an agent.
- A hosted server stays awake while Slack is connected.

## Not confirmed

- Whether a workspace that requires app approval must also approve the **OpenBot** manager app
  itself before **Connect Slack** works. Slack's docs do not say, and this can only be checked after
  Slack enrolls the manager app.
