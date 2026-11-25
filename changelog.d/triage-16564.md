### Fixed

- When an MCP server needs more access for a tool than your sign-in gives, OpenBot now shows "Sign-in needed" for that server, the agent shows a Sign in card, and Sign in asks the service for the missing access. The other tools of the server keep working until you sign in again. Before, the server showed as signed in, the connection test said it was ready, and the tool failed in the chat with a technical "insufficient_scope" error. On a joined server, the server must also be on this version.
