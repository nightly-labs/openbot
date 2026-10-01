### Fixed

- A link to a file that an agent edited now opens the file. Before, a link to a file outside the agent's workspace, a link with a line number such as `page.tsx:12`, a `~/` path or a `file://` link showed "not found" or an error. A file outside the workspace opens only for an agent with Full access, and "Open file externally" shows it in the file manager. ([#1240](https://github.com/nightly-labs/openbot/issues/1240))
- A link to a file that was moved or deleted now says so. Before, it told you to ask the agent to create the file.
