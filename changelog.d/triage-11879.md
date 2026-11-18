### Fixed

- A Codex agent that shows the Standard speed now runs at the standard speed. Before, it used a fast
  tier from the Codex settings file (`service_tier` in `~/.codex/config.toml`), which uses more of the
  plan's limits. On a joined server, the server must also be on this version.
