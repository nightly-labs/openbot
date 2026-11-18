### Fixed

- An OpenCode agent whose model put code for the `execute` tool in a code fence failed on each call
  with "The called value is not a function", and its browser and computer work stopped. OpenCode
  agents now get a rule to send plain code, and to remove the fence and try again after this error.
