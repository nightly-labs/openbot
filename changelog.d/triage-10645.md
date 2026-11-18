### Fixed

- When an agent added or changed the repositories of a GitHub trigger in a workflow, the agent said that
  the change was saved, but the trigger did not keep the list, so the workflow did not start. Now the
  trigger keeps the repositories that the agent gives, and the agent sees the repositories that each
  GitHub trigger watches. For a workflow on a joined server, the server must also be on the new version.
