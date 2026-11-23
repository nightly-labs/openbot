### Fixed

- A Muse agent now runs when one of its apps starts slowly or does not start. Before, Muse stopped the full run with "invalid run configuration: Required MCP server … failed during startup", also when the agent did not need that app. Now the agent continues without the tools of that app.
