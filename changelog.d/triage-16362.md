### Fixed

- When you ask an agent to add an MCP server with an address that holds its key, such as `?token=…`, the agent now saves the full address. Before, it moved the key into an `Authorization` header, and servers that accept the key only in the address refused the connection.
