### Fixed

- An agent's browser tab that is idle for 30 minutes now ends its renderer process, not only its
  page. Saved tabs also start with no renderer process until they are used. Before, each such tab
  kept about 85 MB, and a server with many agent tabs used more than 1 GB for them.
