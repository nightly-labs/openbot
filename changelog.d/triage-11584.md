### Fixed

- When the Pi process of one agent stops unexpectedly, only that agent's turn stops. Before, OpenBot
  stopped and restarted Pi for all Pi agents, and their work stopped with no message to the agents
  that asked for it. Now the other agents keep working. The agent whose Pi stopped shows "Pi stopped
  unexpectedly before it finished this turn. Send a message to continue.", and an agent that asked it
  for work gets this failure as its answer.
