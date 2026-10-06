### Added

- Settings > General has a new "Steer agents while they work" switch. When it is on, a message sent to a busy ChatGPT or Claude agent joins the current work at the next step, and does not wait in the queue. The switch is off by default, so messages queue as before. It also applies to messages from teammates on a server that this computer runs.
- Each agent has a "While working" setting in its settings panel. It uses the app default, or it always queues or always steers for that agent.
- A message that cannot steer waits in the queue with a "Not steered" label and the reason. Grok, OpenCode, Gemini, Cursor, Cline and custom agents cannot steer a running turn. The message starts when the current turn ends.

### Fixed

- A queued message that you steered just as the agent finished its turn no longer shows as done when the agent never read it. It stays in the queue and starts next.
