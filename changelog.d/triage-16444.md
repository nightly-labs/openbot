### Fixed

- Claude agents with Workspace only access can use git with your connected GitHub account again.
  Since 0.77.0, git fetch and git push to GitHub failed in these agents with "could not read
  Username". For an agent on a server, the server must also be on the new version.
