### Fixed

- When the local OpenCode service stopped in the middle of an answer, each running agent turn failed
  with "RequestError: Internal error: OpenCode server is unavailable", and the rest of the answer
  was lost. Now OpenBot starts OpenCode again, and the agent continues its answer one time in its own
  chat. When OpenCode does not stop, the chat shows a plain message that tells you what to do. For an
  agent on a joined server, the server must also be on the new version.
