### Fixed

- On a Mac, command line tools such as `gh`, `gcloud` and `gcalcli` can connect to websites
  when a Claude agent has the Workspace only access. Before, they failed with a certificate error
  (`OSStatus -26276`), because the sandbox blocked the macOS trust service.
