### Fixed

- When a routine has "Run in a separate thread" on, an open wait from the agent's main chat now continues in the main chat when the routine wakes it. Before, the agent continued the request in the routine's thread, so the main chat showed no answer and the wait stayed at "Woke, not closed". The server must also be on the new version.
