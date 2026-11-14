### Fixed

- A provider whose CLI starts slowly from a cold disk now starts. Before, the CLI had 10 s to show its
  version, and after 3 tries OpenBot stopped starting the provider until you refreshed the providers.
  Now, after one slow try, OpenBot gives that CLI up to 2 minutes. On a joined server, the server must
  also be on the new version.
