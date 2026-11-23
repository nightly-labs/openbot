### Fixed

- On Windows, "Check agent" for a custom ACP agent no longer fails with "Error[ref:errno/EBUSY]" when
  the agent answered correctly. Before, OpenBot showed "The agent did not answer" when it could not
  remove its temporary folder at once.
- "Check agent" for a custom agent command that stops before it answers now shows the failure in the
  window. Before, OpenBot itself stopped.
