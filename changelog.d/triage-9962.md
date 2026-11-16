### Fixed

- Keep an OpenCode agent's background subagent running until it ends, for at most 4 hours. Before,
  OpenBot closed the chat's OpenCode session 35 minutes after the last update of the subagent, which
  stopped the subagent. The agent and the chat then got no news of it. Now the end of the subagent,
  also a failure, comes to the agent, and the agent answers in the chat.
