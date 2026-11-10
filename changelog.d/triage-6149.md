### Fixed

- Sign in to an MCP server whose firewall blocks sign-in pages that name `127.0.0.1`. When the
  browser does not come back, try the sign-in again: OpenBot then uses `localhost`. Before, every
  attempt opened the same blocked page.
