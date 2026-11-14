### Fixed

- On Windows, a link in the chat to a local file or folder opens again when the agent writes the path
  as `/C:/…`, or when a folder in the path starts with `.`, `_` or `-`, such as `C:\Users\you\.logs`.
- When a linked file or folder does not exist, the chat now says that it was not found, not "Could not
  preview … Try again".
