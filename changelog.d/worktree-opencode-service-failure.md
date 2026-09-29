### Fixed

- OpenCode agents no longer stop with "Internal error: OpenCode service failure" after a reconnect
  or a restart. OpenCode sends this error when it cannot find a stored session. OpenBot now tries
  the load again one time. If it fails again, OpenBot starts a new OpenCode session with the
  conversation history. When this error stops a turn, the message now tells you to try again or
  reconnect OpenCode.
