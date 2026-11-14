### Fixed

- On Windows, Bitwarden connects with a session key also when you installed the Bitwarden CLI while
  OpenBot was open. You do not have to restart OpenBot. When OpenBot cannot find the CLI, or the vault
  does not have exactly one Shared with OpenBot folder, the error now tells you which step failed.
