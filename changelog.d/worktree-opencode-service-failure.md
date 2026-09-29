### Fixed

- OpenCode agents no longer stop with "Internal error: OpenCode service failure" after a reconnect
  or a restart. OpenCode sends this error when it cannot find a stored session. OpenBot now asks
  OpenCode whether its local service works. If it works, OpenBot starts a new OpenCode session
  with the conversation history. If it does not work, OpenBot keeps the session, tries one more
  time, and then tells you to try again or reconnect OpenCode.
