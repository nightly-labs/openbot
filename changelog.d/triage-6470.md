### Fixed

- On Windows, when OpenBot stops an idle Cursor agent, or another agent that starts from a `.cmd` file, it now stops all of the agent's processes and MCP servers. Before, some of them could keep running in the background and use memory (#6470).
