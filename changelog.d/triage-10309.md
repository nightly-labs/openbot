### Fixed

- When the OpenBot browser stops a download, the agent now gets the reason and can tell you. Before,
  a file larger than 2 GiB, or a download while 4 others were in progress, saved no file and nobody
  knew why. For a file larger than 2 GiB, download it in your own web browser. For an agent on a
  joined server, the server must also be on the new version.
