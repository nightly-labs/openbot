### Fixed

- When the shared tables process cannot start two times in a row, an agent no longer tries again
  without end. OpenBot tells the agent that shared tables are not available now and that it must keep
  its records in a workspace file. OpenBot waits before it tries to start the process again. The log
  now records why the process did not start.
