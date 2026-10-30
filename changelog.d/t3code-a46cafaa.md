### Fixed

- Agents can now open a page that goes to its next page while it loads, as sign-in pages often do. Before, the agent got an `ERR_ABORTED` error, and the `open` tool closed the new tab.
