### Fixed

- Agents now call a tool directly when tool search already returns its schema. Before, the agent instructions told them to describe each tool before its first call, which was in conflict with the search results.
