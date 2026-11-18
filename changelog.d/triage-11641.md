### Fixed

- An OpenCode agent no longer stays stuck when its model puts code for the `execute` tool in a code
  fence. Each such call failed with "The called value is not a function", and browser and computer
  work stopped for that agent. The agent now sends plain code, or removes the fence and tries again.
