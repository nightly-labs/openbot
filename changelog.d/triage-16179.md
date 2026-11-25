### Fixed

- Agents: an agent delete that cannot finish no longer blocks the agent until a restart. If the agent's
  queued work does not end within 30 seconds, the delete stops and tells you to stop the agent and
  cancel its queued messages. The agent is then no longer marked as being deleted, and you can try
  again. Before, the agent stayed marked as being deleted, and each new try said "Agent deletion is
  already in progress."
- Agents: one agent delete that does not finish no longer makes the deletes of other agents wait.
