### Fixed

- Keep a steered message in the queue without an error when a Claude turn ends at the same time.
  Before, the chat showed "Unknown Claude thread". The message now goes to the agent after the turn.
