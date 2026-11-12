### Fixed

- When the shared database cannot start at first use, an agent now gets an error that tells it to try again, not an empty table list. Before, the agent could say that there were no tables, or make a second copy of a table that exists. Tables in agent settings now shows "Shared data is unavailable." in this case, not "No tables yet".
