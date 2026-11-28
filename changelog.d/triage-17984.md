### Fixed

- A Claude agent's answer no longer shows two times in the chat after OpenBot or the server starts
  again. Before, when Claude did not run a message and OpenBot sent it again, the next start added a
  second copy of the answer. Copies that are already in a chat stay. For an agent on a joined server,
  the server must also be on this version.
