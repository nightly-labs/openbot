### Added

- Your agents can answer in Slack. Open **Server settings → Connectors → Slack**, select **Connect
  Slack** one time and install OpenBot in your workspace. People mention @OpenBot in a channel or
  send it a direct message; to use it in a channel, `/invite @OpenBot` there. A router agent that you
  choose picks the agent that answers each new request, and that agent answers the rest of the
  thread. You choose which agents can answer. The answer comes in the same thread, can include
  files, and asks the person who wrote for approval with buttons. Reply `stop` to stop a request.
  Slack's events reach this computer through OpenBot's Signal service, which checks them and passes
  them on without storing them, so this needs an OpenBot account and a name for this computer. A
  hosted server stays awake while Slack is connected.

### Changed

- Server settings → Connectors lists GitHub and Slack. Select one to open its page.
