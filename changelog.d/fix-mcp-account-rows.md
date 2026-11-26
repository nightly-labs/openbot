### Fixed

- A new MCP server on an address that another MCP server already uses now has its own sign-in. Before, the two servers shared one sign-in: the second one used the account of the first, and a sign-in on one changed the account of the other. Two servers that already share an address keep their shared sign-in; remove one and add it again to give it its own sign-in.
