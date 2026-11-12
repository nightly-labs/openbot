### Fixed

- Keep the files that an agent puts in OpenBot's API key folder. Before, each Vault change and each
  start of OpenBot deleted every file in that folder that was not a Vault key, such as a private key
  file that cannot be downloaded again.
