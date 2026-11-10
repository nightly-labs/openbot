### Fixed

- Claude agents use less of the plan limit. Before, after you or the agent edited its Instructions, a
  later change such as a sidebar move made Claude write the whole conversation to its prompt cache
  again. Now an Instructions edit goes with the next message, and the agent follows it from that
  message on.
