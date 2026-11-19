### Changed

- Agents now finish your request without a "continue" from you. When a turn that used tools ends,
  the agent's model checks the request against the work and the answer. When a part is not done, the
  agent continues with that part, at most 3 times for one request. A question that needs your choice
  or approval still stops the agent. On a joined server, the server must also be on the new version.
