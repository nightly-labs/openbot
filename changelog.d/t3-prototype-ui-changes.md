### Added

- When you scroll away from a subagent card while its subagents work, its header now stays under the chat header with the progress, the current step and the time. Click it to go back to the card.

### Fixed

- When an OpenCode, Kimi, Cline or Hermes agent starts a subagent, the chat now shows the subagent card with its task, its state and its time. Before, these agents showed no card, so the agent looked idle while its subagents worked.
- A Codex subagent card now shows the subagent's steps while it works: its commands, thoughts and messages. Before, the card showed only the task until the subagent ended.
- An OpenCode subagent card now shows the subagent's reads, searches, commands, thoughts and messages, and the error when the subagent fails.
- An agent whose subagents still run now shows as working in the sidebar, also when a background subagent runs on after the agent's turn. Before, the agent showed as idle.
- When a subagent fails, OpenBot now tells you: a desktop notification when you are not in the app, and an alert when another chat is open. It uses the agent's notification settings.
