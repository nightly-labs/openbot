### Fixed

- An agent can open a browser page in a new chat again when its other chats have many open tabs.
  Before, the agent got "The browser can have up to 25 open tabs." but found no tabs to close,
  because the limit counted the tabs of all chats of the agent. Now each chat can have up to 25
  open tabs, and the limit counts only the tabs that the agent can see and close in that chat.
