### Added

- Agents can answer in Slack. Open **Server settings → Connectors → Slack**, select **Connect Slack**
  one time and pick your workspace, then select **Add agent** for each agent and allow the install.
  Each agent gets its own Slack app and bot user, renamed with the agent and deleted when you remove
  it. The agent joins every public channel by itself, and its Slack app has the agent's avatar as its
  icon. People can mention the agent in a channel, reply in that thread, or send it a direct message;
  a private channel needs `/invite`. The agent answers in the same thread, can read and send files, and asks the person who
  wrote for approval with buttons. Reply `stop` to stop a request. Slack's events reach this computer
  through OpenBot's Signal service, which passes them on without storing them, so this needs an
  OpenBot account and a name for this computer. A hosted server stays awake while Slack is connected.

### Changed

- Server settings → Connectors lists GitHub and Slack. Select one to open its page.
