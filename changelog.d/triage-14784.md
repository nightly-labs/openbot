### Fixed

- On Windows, chats and routines of a Claude agent with "Workspace only" access start again when
  Windows does not let OpenBot link the workspace skills folder. Before, each turn failed with an
  "EPERM: operation not permitted, symlink" error. In this case, the agent works without the skills
  in its workspace `.claude\skills` folder.
