### Changed

- Channel members get the saved channel memories again only when the memories change. Before, each
  turn sent all the channel memories again.
- A Claude agent keeps its saved memories and section list in the conversation after an MCP server,
  skill or setting change. Before, the next turn sent all of them again.
- After a restart, the background memory review reads only the messages after its last review.
  Before, the first review after a restart read up to 200 messages again.
