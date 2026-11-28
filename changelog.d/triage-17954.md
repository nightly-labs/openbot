### Fixed

- On Windows and Linux, the Backup models page of an agent with Workspace only now marks each
  backup that cannot run with Workspace only, such as OpenCode, Antigravity or Devin, with
  "Skipped with Workspace only · change Permissions to use it". The agent also tells you which
  backups it will skip when it changes its backup models or its access. Before, these backups
  looked ready, but the agent never used them and stopped at the usage limit.
