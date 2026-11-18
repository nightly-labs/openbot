### Fixed

- On Windows, when work of another OpenCode agent keeps OpenCode open, a deleted agent's folder stays
  in use and the delete fails. The app now says that another agent's work uses the folder, and that
  the delete can succeed when that work ends or after a restart. Before, it only asked to retry the
  delete, and each retry failed in the same way.
