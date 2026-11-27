### Fixed

- When you add an MCP server on an address that another MCP server already uses, the new server now signs in to its own account. Before, both servers used one sign-in: the new server acted as the account of the other server, and a sign-in on one server changed the account of both. Servers that already share an address keep their shared sign-in. To give one of them its own sign-in, edit its address and add `#account-` and a name at the end, such as `#account-work`.
