### Fixed

- When a Claude account reaches its 5-hour limit, an agent with automatic backup models now moves to its next ready backup. An agent with no backup waits for the reset. Before, OpenBot did not see the "You've hit your 5-hour limit" message as a limit, so each message failed with an internal error and the agent stayed on Claude until you changed the model by hand.
