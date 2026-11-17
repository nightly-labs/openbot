### Fixed

- When the OpenBot GitHub App cannot see or change a repository, the error of a workflow step now names
  the repository, for example "cannot see the repository acme/app". Before, it said only "this
  repository", so with a trigger on many repositories you could not tell which one needed access on
  GitHub. For a workflow on a joined server, the server must also be on the new version.
