### Fixed

- When the Claude process of a chat stops unexpectedly while a subagent or a background command still runs, the agent now gets a turn at once. It tells you what stopped and starts again the work that your request still needs. Before, the work stopped and nobody was told until your next message. On a joined server, the server must also be on this version.
