### Added

- Settings > Providers has **Disconnect** in the ⋯ menu of the Claude and Codex sign-in, on this
  computer and in Server settings of a server. It signs the provider out and removes the stored
  sign-in. On this computer, the `claude` or `codex` CLI in the terminal signs out too (#3487).

### Fixed

- **Log in with code** for Codex works when the stored ChatGPT sign-in can no longer refresh. Before,
  it failed with "Your access token could not be refreshed", or the code dialog closed after a second
  with "Connect ChatGPT to continue".
