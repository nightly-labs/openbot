### Fixed

- OpenCode agents no longer stop with "Internal error: OpenCode service failure" after a reconnect
  or a restart. OpenCode sends this error when it cannot find a stored session. OpenBot now reads
  OpenCode's session list. If the list does not hold the session, OpenBot starts a new OpenCode
  session with the conversation history. In all other cases OpenBot keeps the session, tries one
  more time, and then tells you to try again or reconnect OpenCode.
