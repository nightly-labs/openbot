### Fixed

- You can delete an agent whose folder holds a `.asar` file, for example after a package install of an
  Electron project. Before, the delete never ended, other agent deletes waited for it, and each new try
  failed with "Agent deletion is already in progress." until OpenBot restarted.
