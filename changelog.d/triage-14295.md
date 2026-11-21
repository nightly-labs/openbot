### Fixed

- On Windows, "Check agent" for a custom ACP agent no longer fails with "Error[ref:errno/EBUSY]" when
  the agent answered correctly. Before, OpenBot showed "The agent did not answer" when it could not
  remove its temporary folder at once.
