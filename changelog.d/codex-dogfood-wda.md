### Changed

- TrueSMAC reads a native iOS simulator screen in the main chat through Appium, without a manually started WebDriverAgent. The agent creates its own session on an approved, booted simulator and deletes only sessions it created.

### Fixed

- The registered Appium MCP server is no longer given to an agent whose Computer Use is off. Before, the agent could still reach a simulator or device through Appium, because only Computer Use was removed from its tools.
- A deleted server on this computer keeps its pending account removal when an older OpenBot build saves the same server list. Before, that build could drop the pending removal, so the account kept listing a server that was already deleted here.
- A server on this computer whose list cannot be read is no longer started, deleted, restarted or changed. Before, a damaged list could still start the servers, and a delete could move a server's folders to the Trash before the list refused the change. Those folders stay where they are.
