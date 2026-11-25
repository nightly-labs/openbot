### Fixed

- Skills: you can now install, update, turn off and remove skills for an agent whose workspace folder
  is a link (a symbolic link or a Windows junction) to a folder on another disk. Before, each of these
  actions failed with "Skill installation paths cannot contain symbolic links." Links inside the
  workspace, for example at `.agents` or `.claude`, are still refused.
