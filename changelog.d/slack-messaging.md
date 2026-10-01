### Added

- Your agents can answer in Slack. Open **Server settings → Connectors → Slack**, select **Connect
  Slack** one time and install OpenBot in your workspace. People mention @OpenBot in a channel or
  send it a direct message. OpenBot joins every public channel by itself; a private channel needs
  `/invite @OpenBot`. The connect dialog also
  adds the Slack Orchestrator, an agent on the model you pick, in a collapsed **Integrations** section of
  the sidebar: it receives each request, gives the
  work to the agent that fits best, and posts the answer in the thread. The answer comes in the same thread, can include
  files, and asks the person who wrote for approval with buttons. Reply `stop` to stop a request.
  Slack's events reach this computer through OpenBot's Signal service, which checks them and passes
  them on without storing them, so this needs an OpenBot account and a name for this computer. A
  hosted server stays awake while Slack is connected.

### Changed

- Server settings → Connectors lists GitHub and Slack. Select one to open its page.
