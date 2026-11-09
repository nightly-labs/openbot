### Changed

- When an agent's Slack post pings a person, that person can reply in the thread without
  mentioning OpenBot. The reply goes to the Slack Orchestrator, with the post and the name of the
  agent that sent it. Before, a reply with no mention reached no agent. In that thread, replies of
  other people always need a mention.
- In a Slack thread, an agent can stay quiet when a message needs no answer, such as thanks.
  OpenBot then removes its "Working on it…" post and keeps the ✅ reaction.
