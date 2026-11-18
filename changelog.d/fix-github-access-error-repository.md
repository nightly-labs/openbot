### Fixed

- The GitHub errors of a workflow now name the repository that needs access, for example "cannot see
  the repository acme/app". Before, they said only "this repository", so with a trigger on many
  repositories you could not tell which one needed access on GitHub. For a workflow on a joined
  server, the server must also be on the new version. A client on an older version shows these errors
  in English, because it does not have their translations.
- When GitHub refuses to show the labels, the people or the recent events of a repository, the error
  now says that OpenBot cannot read the repository. Before, it said that the app cannot change it.
- When OpenBot reads a repository with your own GitHub sign-in, an access error now names your GitHub
  account, not the OpenBot GitHub App.
- When an issue or a pull request is deleted or hidden, the error now names its number and says that
  it is missing or hidden. Before, it said that the repository needs access.
- When GitHub refuses requests because of its rate limit, the error now says to wait a few minutes.
  Before, it said that the app cannot change the repository.
