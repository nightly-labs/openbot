### Fixed

- Agents: when a custom agent, such as Hermes, or another ACP agent sends nothing for a long time,
  OpenBot now gives it a few seconds to stop or to send its answer before it ends the turn. An answer
  that arrives in that time now shows in the chat. Before, OpenBot ended the turn at once with
  "stopped responding" and did not show an answer that the agent sent a moment later. On a joined
  server, the server must also be on the new version.
