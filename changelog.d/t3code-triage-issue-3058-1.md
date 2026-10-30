### Fixed

- A Cursor agent can use OpenBot's tools and message its teammates when `openbot` is in Cursor's list of disabled MCP servers for the project. Before, Cursor started the agent without OpenBot's tools and showed no error, so messages to teammates were not sent.
- When Cursor does not load OpenBot's tools for another reason, such as a Cursor team policy, the chat shows an error. Before, the turn ended and the model reported tool errors that did not occur.
