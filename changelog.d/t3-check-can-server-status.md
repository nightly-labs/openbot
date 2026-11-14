### Fixed

- On a cloud server or a self-hosted server, each turn of a Claude agent with "Workspace only" failed with "Workspace only needs the Claude sandbox, which Claude cannot start on this computer" when the machine had no `socat`. The server now installs `socat` with its other packages. The server must also be on the new version.
