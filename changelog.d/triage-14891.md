### Fixed

- When a local script or an agent changes an agent's model with `openbot-cli` to a model of a provider that is not installed, OpenBot now refuses the change with the reason, such as "OpenCode is not installed.". Before, the change failed with only "internal error". For an agent on a server, the server must be on the new version.
