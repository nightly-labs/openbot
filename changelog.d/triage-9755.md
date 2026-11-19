### Fixed

- You can change the provider of an agent after a usage limit stopped its tasks. Before, a task
  that had stopped could still count as running, and the change was refused with "Tasks of this
  agent are running" until you restarted OpenBot. Such a task now shows as interrupted. On a joined
  server, the server must also run this version.
