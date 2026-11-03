### Added

- Agents learn from how you use them. When the chat shows that an agent did something wrong for you, such as a correction or work you had to ask for again, the agent suggests a rule in its chat. Add to instructions puts the rule in that agent's own instructions file, under "Learned rules". Dismiss keeps it out, and the agent does not suggest it again. Undo takes back either answer. Each rule changes only that agent.

### Changed

- A change to an agent's instructions file reaches its running chat with the next message. Before, a Codex agent started a new session after the change and kept only a summary of the chat.
